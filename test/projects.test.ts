import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrateDatabase, projectKey } from "@aoverview/core";
import { groupSessionsByProject } from "../apps/dashboard/src/projects.js";
import { delegate, expectCode, fixture, open, update } from "./helpers.js";

test("free-text projects unify case, accents, Unicode and separators across persisted sessions", t => {
  const f = fixture(t);
  const start = (project: string) => f.store.open({ requestId: randomUUID(), title: "Work", agentName: "Codex", project });
  const first = start("  AOVerview  ");
  f.store.setSessionArchived(first.sessionId, true);
  for (const name of ["aoverview", "AO-verview", "AO_VERVIEW", "ao verview", "ＡＯＶｅｒｖｉｅｗ", "AÓVerview"]) {
    const root = start(name);
    assert.equal(root.project, "AOVerview");
    const session = f.connect(true).getSession(root.sessionId).session;
    assert.equal(session.project, "AOVerview");
    assert.equal(session.projectKey, "aoverview");
    assert.equal(f.store.resume({ handle: root.handle }).project, "AOVerview");
  }
  assert.notEqual(projectKey("C++"), projectKey("C"));
  assert.notEqual(start("AOVerview API").project, first.project);
  const readable = start("  Skill   Gesture  ");
  assert.equal(readable.project, "Skill Gesture");
  for (const invalid of ["", "   ", "___---", "x".repeat(101), 123, null]) {
    assert.throws(() => start(invalid as string));
  }
});

test("main agents set or clear projects atomically, preserving isolation and inherited child context", t => {
  const f = fixture(t); const root = open(f.store, false); const other = open(f.store, false);
  const known = f.store.open({ requestId: randomUUID(), title: "Existing project", agentName: "Pi", project: "Fentaris" });
  const sequence = f.store.latestSequence();
  const report = { handle: root.handle, requestId: randomUUID(), expectedRevision: root.revision,
    operations: [{ op: "project", name: "AOVerview" }, { op: "block", id: "work", title: "Implement grouping", status: "active" }] };
  const result = f.store.update(report); root.revision = result.revision;
  assert.deepEqual(f.store.update(report), result);
  assert.equal(f.store.latestSequence(), sequence + 1);
  const child = delegate(f.store, root);
  assert.equal(child.project, "AOVerview");
  assert.equal(f.store.resume({ handle: child.handle }).project, "AOVerview");
  expectCode(() => update(f.store, child, [{ op: "project", name: "Other" }]), "FORBIDDEN");
  const revision = root.revision;
  expectCode(() => update(f.store, root, [{ op: "project", name: "Other" }, { op: "block", id: "missing", status: "active" }]), "TITLE_REQUIRED");
  assert.equal(f.store.resume({ handle: root.handle }).project, "AOVerview");
  assert.equal(f.store.resume({ handle: root.handle }).revision, revision);
  update(f.store, root, [{ op: "project", name: "FÉNTARIS" }]);
  assert.equal(f.store.resume({ handle: child.handle }).project, known.project);
  assert.equal(f.store.getSession(other.sessionId).session.project, null);
  assert.equal(f.store.getSession(root.sessionId).session.projectKey, "fentaris");
  update(f.store, root, [{ op: "project", name: null }]);
  assert.equal(f.store.getSession(root.sessionId).session.project, null);
  assert.equal(f.store.getSession(root.sessionId).session.projectKey, null);
});

test("version-three migration preserves history, receipts, archives and revisions with no assigned project", t => {
  const f = fixture(t); const root = open(f.store);
  update(f.store, root, [{ op: "block", id: "work", title: "Existing work", status: "active" }]);
  f.store.setSessionArchived(root.sessionId, true);
  const before = f.store.getSession(root.sessionId);
  const sequence = f.store.latestSequence();
  const receipts = f.store.db.prepare("SELECT * FROM receipts ORDER BY scope,requestId").all();
  f.store.db.exec("DROP INDEX sessions_project; ALTER TABLE sessions DROP COLUMN project; ALTER TABLE sessions DROP COLUMN projectKey; PRAGMA user_version=3;");
  migrateDatabase(f.path); migrateDatabase(f.path);
  const reader = f.connect(true);
  assert.deepEqual(reader.getSession(root.sessionId), before);
  assert.deepEqual(reader.db.prepare("SELECT * FROM receipts ORDER BY scope,requestId").all(), receipts);
  assert.equal(reader.resume({ handle: root.handle }).revision, root.revision);
  assert.equal(reader.latestSequence(), sequence);
  assert.equal(reader.listSessions().items.length, 0);
});

test("dashboard grouping combines sessions across pages, keeps latest order and puts unassigned work last", t => {
  const f = fixture(t);
  const start = (project?: string) => f.store.open({ requestId: randomUUID(), title: "Work", agentName: "Codex", ...(project ? { project } : {}) });
  const roots = [start("AOVerview"), start("Fentaris"), start("AO-VERVIEW"), start()];
  const rows = roots.map(root => f.store.listSessions().items.find(session => session.id === root.sessionId)!);
  const groups = groupSessionsByProject([rows[3]!, rows[1]!, rows[2]!, rows[0]!]);
  assert.deepEqual(groups.map(group => [group.name, group.sessions.map(session => session.id)]), [
    ["Fentaris", [roots[1]!.sessionId]],
    ["AOVerview", [roots[2]!.sessionId, roots[0]!.sessionId]],
    ["Senza progetto", [roots[3]!.sessionId]],
  ]);
  f.store.setSessionArchived(roots[2]!.sessionId, true);
  assert.equal(groupSessionsByProject(f.store.listSessions().items).find(group => group.key === "aoverview")?.sessions.length, 1);
  assert.deepEqual(groupSessionsByProject([]), []);
});
