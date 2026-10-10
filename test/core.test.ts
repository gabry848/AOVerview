import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { migrateDatabase, type Mutation } from "@aoverview/core";
import { delegate, expectCode, fixture, open, update, type Writer } from "./helpers.js";

test("opening and updating are idempotent; different content cannot reuse a request ID", t => {
  const { store } = fixture(t);
  const input = { requestId: randomUUID(), title: "A session", agentName: "Root" };
  const identity = store.open(input);
  assert.deepEqual(store.open(input), identity);
  expectCode(() => store.open({ ...input, title: "Different" }), "REQUEST_REUSED");
  assert.equal(store.listSessions().items.length, 1);
  const request = { handle: identity.handle, expectedRevision: 0, requestId: "step-1",
    operations: [{ op: "block", id: "work", title: "Investigate", status: "active" }] };
  const result = store.update(request);
  assert.deepEqual(store.update(request), result);
  assert.equal(store.latestSequence(), 2);
  expectCode(() => store.update({ ...request, expectedRevision: 1 }), "REQUEST_REUSED");
});

test("invalid batches roll back goals, blocks, revision, receipts and change notifications", t => {
  const { store } = fixture(t);
  const root = open(store, false);
  expectCode(() => update(store, root, [
    { op: "goal", id: "new", title: "New goal" },
    { op: "block", id: "bad", title: "Bad reference", status: "active", goalId: "missing" },
  ], "batch"), "INVALID_GOAL");
  assert.equal(store.getSession(root.sessionId).goals.length, 0);
  assert.equal(store.listBlocks(root.agentId).items.length, 0);
  assert.equal(store.resume({ handle: root.handle }).revision, 0);
  assert.equal(store.latestSequence(), 1);
  update(store, root, [{ op: "goal", id: "new", title: "Corrected goal" }], "batch");
  assert.equal(root.revision, 1);
});

test("one active block is enforced on the final batch state and completed history cannot reopen", t => {
  const { store } = fixture(t);
  const root = open(store);
  update(store, root, [{ op: "block", id: "b1", title: "Explore", status: "active" }]);
  expectCode(() => update(store, root, [{ op: "block", id: "b2", title: "Build", status: "active" }]), "MULTIPLE_ACTIVE_BLOCKS");
  assert.equal(store.listBlocks(root.agentId).items.length, 1);
  update(store, root, [
    { op: "block", id: "b2", title: "Build", status: "active" },
    { op: "block", id: "b1", status: "completed", outcome: "Requirements identified" },
  ]);
  expectCode(() => update(store, root, [{ op: "block", id: "b1", status: "active" }]), "INVALID_TRANSITION");
  update(store, root, [{ op: "block", id: "b2", status: "blocked", concern: "Need a decision" }]);
  update(store, root, [{ op: "block", id: "b3", title: "Verify another part", status: "active" }]);
  assert.equal(store.resume({ handle: root.handle }).blocked.length, 1);
});

test("partial updates preserve fields and detail IDs; null explicitly clears values", t => {
  const { store } = fixture(t);
  const root = open(store);
  update(store, root, [{ op: "block", id: "work", title: "Persistence", status: "active", goalId: "g1", summary: "Save progress", concern: "Unverified",
    details: [{ id: "d1", action: "Inspect storage", result: "Ready", reference: "src/storage.ts" }, { id: "d2", action: "Define transactions" }] }]);
  update(store, root, [{ op: "block", id: "work", concern: null, details: [{ id: "d1", action: "Inspect persistent storage", result: null }] }]);
  const block = store.getBlock(root.agentId, "work");
  assert.equal(block.title, "Persistence"); assert.equal(block.summary, "Save progress");
  assert.equal(block.goalId, "g1"); assert.equal(block.concern, null);
  assert.equal(block.details.length, 2); assert.equal(block.details[0]?.result, null);
  assert.equal(block.details[1]?.action, "Define transactions");
  assert.equal(block.details[0]?.reference, "src/storage.ts");
  assert.equal(block.details[1]?.reference, null);
  update(store, root, [{ op: "block", id: "work", details: [{ id: "d1", action: "Inspect persistent storage", reference: "test/storage.test.ts" }] }]);
  assert.equal(store.getBlock(root.agentId, "work").details[0]?.reference, "test/storage.test.ts");
  update(store, root, [{ op: "block", id: "work", details: [{ id: "d1", action: "Inspect persistent storage", reference: null }] }]);
  assert.equal(store.getBlock(root.agentId, "work").details[0]?.reference, null);
});

test("detail levels default to medium, persist per session and propagate through nested delegates", t => {
  const f = fixture(t);
  assert.equal(open(f.store).detailLevel, "medium");
  for (const detailLevel of ["low", "medium", "high"] as const) {
    const input = { requestId: randomUUID(), title: "Library", agentName: "Main", detailLevel,
      goals: [{ id: "g1", title: "Deliver a complete library" }] };
    const root = f.store.open(input);
    assert.deepEqual(f.store.open(input), root);
    assert.equal(root.detailLevel, detailLevel);
    update(f.store, root, [{ op: "block", id: "work", title: "Build storage", goalId: "g1", status: "active" }]);
    const child = delegate(f.store, root);
    update(f.store, child, [{ op: "block", id: "work", title: "Verify storage", status: "active" }]);
    const grandchild = delegate(f.store, child);
    for (const writer of [root, child, grandchild]) {
      assert.equal(writer.detailLevel, detailLevel);
      assert.equal(f.connect(true).resume({ handle: writer.handle }).detailLevel, detailLevel);
    }
    update(f.store, root, [{ op: "block", id: "work", status: "completed" }]);
    const snapshot = f.connect(true).getSession(root.sessionId);
    assert.equal(snapshot.session.detailLevel, detailLevel);
    assert.equal(snapshot.goals[0]?.title, "Deliver a complete library");
    assert.equal(snapshot.goals[0]?.status, "pending");
    assert.equal(f.store.listSessions().items.find(s => s.id === root.sessionId)?.detailLevel, detailLevel);
  }
  assert.throws(() => f.store.open({ requestId: randomUUID(), title: "Bad", agentName: "Main", detailLevel: "very-high" }));
  assert.equal(f.store.listSessions().items.length, 4);
});

test("invalid references are rejected without changing block, revision or notifications", t => {
  const { store } = fixture(t); const root = open(store);
  update(store, root, [{ op: "block", id: "work", title: "Inspect evidence", status: "active" }]);
  const sequence = store.latestSequence();
  for (const reference of [" ", "x".repeat(601), 123]) {
    assert.throws(() => store.update({ handle: root.handle, requestId: randomUUID(), expectedRevision: root.revision,
      operations: [{ op: "block", id: "work", details: [{ id: "d1", action: "Check evidence", reference }] }] }));
  }
  assert.equal(store.getBlock(root.agentId, "work").detailCount, 0);
  assert.equal(store.resume({ handle: root.handle }).revision, root.revision);
  assert.equal(store.latestSequence(), sequence);
});

test("migration upgrades version-one data without changing history or exact retry receipts", t => {
  const f = fixture(t);
  const input = { requestId: randomUUID(), title: "Legacy session", agentName: "Pi" };
  const root = f.store.open(input);
  update(f.store, root, [{ op: "block", id: "work", title: "Legacy work", status: "active",
    details: [{ id: "d1", action: "Checked legacy storage", result: "Existing data available" }] }]);
  const before = f.store.getBlock(root.agentId, "work");
  const sequence = f.store.latestSequence();
  // Restore the v1 table shape and original receipt payload, as stored by released clients.
  const { detailLevel: _, project: _project, ...legacyIdentity } = { ...root, revision: 0 };
  f.store.db.exec("DROP INDEX sessions_project; ALTER TABLE sessions DROP COLUMN project; ALTER TABLE sessions DROP COLUMN projectKey; ALTER TABLE sessions DROP COLUMN detailLevel; ALTER TABLE sessions DROP COLUMN archivedAt; ALTER TABLE details DROP COLUMN reference; PRAGMA user_version=1;");
  f.store.db.prepare("UPDATE receipts SET result=? WHERE scope='open' AND requestId=?").run(JSON.stringify(legacyIdentity), input.requestId);
  migrateDatabase(f.path);
  migrateDatabase(f.path);
  const writer = f.connect();
  assert.equal(writer.getSession(root.sessionId).session.detailLevel, "medium");
  assert.deepEqual(writer.getBlock(root.agentId, "work"), before);
  assert.deepEqual(writer.open(input), legacyIdentity);
  assert.equal(writer.resume({ handle: root.handle }).detailLevel, "medium");
  assert.equal(writer.latestSequence(), sequence);
  update(writer, root, [{ op: "block", id: "work", details: [{ id: "d1", action: "Checked legacy storage", reference: "src/storage.ts" }] }]);
  assert.equal(f.connect(true).getBlock(root.agentId, "work").details[0]?.reference, "src/storage.ts");
});

test("archiving persists, filters before pagination and keeps agent work and history intact", t => {
  const f = fixture(t);
  const roots = Array.from({ length: 3 }, () => open(f.store));
  const root = roots[1]!;
  update(f.store, root, [{ op: "block", id: "work", title: "Ongoing work", status: "active",
    details: [{ id: "d1", action: "Keep the existing history" }] }]);
  const before = f.store.getSession(root.sessionId);
  const block = f.store.getBlock(root.agentId, "work");
  const sequence = f.store.latestSequence();
  const archived = f.store.setSessionArchived(root.sessionId, true);
  assert.equal(typeof archived.archivedAt, "number");
  assert.deepEqual(f.store.setSessionArchived(root.sessionId, true), archived);
  assert.equal(f.store.latestSequence(), sequence + 1);
  assert.deepEqual(f.store.changesSince(sequence).map(event => ({ ...event })),
    [{ sequence: sequence + 1, sessionId: root.sessionId, agentId: root.agentId }]);
  const first = f.store.listSessions(1);
  const second = f.store.listSessions(1, Number(first.nextCursor));
  assert.equal(first.items.length, 1); assert.equal(first.nextCursor, "1");
  assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.items, ...second.items].map(item => item.id)),
    new Set(roots.filter(item => item !== root).map(item => item.sessionId)));
  const after = f.store.getSession(root.sessionId);
  assert.deepEqual({ ...after.session }, archived);
  assert.deepEqual({ ...after, session: before.session }, before);
  assert.deepEqual(f.store.getBlock(root.agentId, "work"), block);
  assert.equal(f.store.resume({ handle: root.handle }).revision, root.revision);
  migrateDatabase(f.path);
  assert.equal(f.connect(true).listSessions().items.length, 2);
  assert.equal(f.connect(true).getSession(root.sessionId).session.archivedAt, archived.archivedAt);
  update(f.store, root, [{ op: "block", id: "work", summary: "Updates continue while archived" }]);
  assert.equal(f.store.listSessions().items.some(item => item.id === root.sessionId), false);
  const restored = f.store.setSessionArchived(root.sessionId, false);
  assert.equal(restored.archivedAt, null);
  assert.equal(f.store.listSessions().items.length, 3);
  const restoredSequence = f.store.latestSequence();
  assert.deepEqual(f.store.setSessionArchived(root.sessionId, false), restored);
  assert.equal(f.store.latestSequence(), restoredSequence);
  expectCode(() => f.store.setSessionArchived("missing", true), "NOT_FOUND");
  expectCode(() => f.connect(true).setSessionArchived(root.sessionId, true), "READ_ONLY");
});

test("migration adds archive state to version-two sessions without changing stored work", t => {
  const f = fixture(t); const root = open(f.store);
  update(f.store, root, [{ op: "block", id: "work", title: "Existing work", status: "active" }]);
  const before = f.store.getSession(root.sessionId);
  const sequence = f.store.latestSequence();
  f.store.db.exec("DROP INDEX sessions_project; ALTER TABLE sessions DROP COLUMN project; ALTER TABLE sessions DROP COLUMN projectKey; ALTER TABLE sessions DROP COLUMN archivedAt; PRAGMA user_version=2;");
  migrateDatabase(f.path); migrateDatabase(f.path);
  assert.deepEqual(f.connect(true).getSession(root.sessionId), before);
  assert.equal(f.store.latestSequence(), sequence);
  assert.equal(f.store.listSessions().items.length, 1);
});

test("tentative blocks can change or be cancelled but cannot contain performed work", t => {
  const { store } = fixture(t); const root = open(store);
  update(store, root, [{ op: "block", id: "next", title: "Implement API" }]);
  expectCode(() => update(store, root, [{ op: "block", id: "next", details: [{ id: "d1", action: "Implemented API" }] }]), "UNSTARTED_BLOCK");
  update(store, root, [{ op: "block", id: "next", title: "Clarify API contract", summary: "Requirements changed" }]);
  update(store, root, [{ op: "block", id: "next", status: "active" }]);
  assert.notEqual(store.getBlock(root.agentId, "next").startedAt, null);
  update(store, root, [{ op: "block", id: "unused", title: "Maybe later" }, { op: "block", id: "unused", status: "cancelled" }]);
  assert.equal(store.getBlock(root.agentId, "unused").startedAt, null);
});

test("agents and sessions are isolated; only the main agent manages goals", t => {
  const { store } = fixture(t); const root = open(store); const other = open(store, false);
  update(store, root, [{ op: "block", id: "work", title: "Main work", status: "active", goalId: "g1" }]);
  const child = delegate(store, root);
  expectCode(() => update(store, child, [{ op: "goal", id: "g1", title: "Overwrite root" }]), "FORBIDDEN");
  assert.equal(store.getSession(root.sessionId).agents.find(a => a.id === child.agentId)?.status, "reserved");
  update(store, child, [{ op: "block", id: "work", title: "Child work", status: "active" }]);
  update(store, other, [{ op: "block", id: "work", title: "Other session", status: "active" }]);
  assert.equal(store.getBlock(root.agentId, "work").title, "Main work");
  assert.equal(store.getBlock(child.agentId, "work").title, "Child work");
  assert.equal(store.getBlock(other.agentId, "work").title, "Other session");
  expectCode(() => update(store, other, [{ op: "block", id: "work", goalId: "g1" }]), "INVALID_GOAL");
  expectCode(() => store.resume({ handle: "missing" }), "INVALID_HANDLE");
  update(store, child, [{ op: "block", id: "work", goalId: null }]);
  update(store, child, [{ op: "block", id: "work", summary: "Unrelated edit" }]);
  assert.equal(store.getBlock(child.agentId, "work").goalId, null);
});

test("subagent completion is separate from integration; nested delegation is supported", t => {
  const { store } = fixture(t); const root = open(store);
  update(store, root, [{ op: "block", id: "work", title: "Coordinate", status: "active" }]);
  const child = delegate(store, root);
  update(store, child, [{ op: "block", id: "work", title: "Specialist work", status: "active" }]);
  const grandchild = delegate(store, child);
  expectCode(() => update(store, root, [{ op: "delegation", childAgentId: grandchild.agentId, status: "cancelled" }]), "FORBIDDEN");
  update(store, child, [{ op: "delegation", childAgentId: grandchild.agentId, status: "cancelled" }]);
  expectCode(() => update(store, root, [{ op: "delegation", childAgentId: child.agentId, status: "integrated", blockId: "work" }]), "INVALID_TRANSITION");
  update(store, child, [{ op: "block", id: "work", status: "completed", outcome: "Verified" }, { op: "finish", status: "completed" }]);
  assert.equal(store.getSession(root.sessionId).agents.find(a => a.id === child.agentId)?.integratedAt, null);
  update(store, root, [{ op: "delegation", childAgentId: child.agentId, status: "integrated", blockId: "work", note: "Used the verified contribution" }]);
  const integrated = store.getSession(root.sessionId).agents.find(a => a.id === child.agentId);
  assert(integrated?.integratedAt); assert.equal(integrated.integrationNote, "Used the verified contribution");
  assert.equal(store.getSession(root.sessionId).agents.find(a => a.id === grandchild.agentId)?.status, "cancelled");
});

test("unstarted reservations can be cancelled and running children cannot", t => {
  const { store } = fixture(t); const root = open(store);
  update(store, root, [{ op: "block", id: "work", title: "Delegate", status: "active" }]);
  const child = delegate(store, root);
  update(store, root, [{ op: "delegation", childAgentId: child.agentId, status: "cancelled" }]);
  expectCode(() => update(store, child, [{ op: "block", id: "work", title: "Too late", status: "active" }]), "REVISION_CONFLICT");
  child.revision = store.resume({ handle: child.handle }).revision;
  expectCode(() => update(store, child, [{ op: "block", id: "work", title: "Too late", status: "active" }]), "AGENT_FINISHED");
  const running = delegate(store, root);
  update(store, running, [{ op: "block", id: "work", title: "Started", status: "active" }]);
  expectCode(() => update(store, root, [{ op: "delegation", childAgentId: running.agentId, status: "cancelled" }]), "INVALID_TRANSITION");
});

test("successful finishing requires goals, blocks and descendants to be resolved", t => {
  const { store } = fixture(t); const root = open(store);
  update(store, root, [{ op: "block", id: "work", title: "Coordinate", status: "active" }, { op: "block", id: "next", title: "Tentative follow-up" }]);
  expectCode(() => update(store, root, [{ op: "finish", status: "completed" }]), "UNFINISHED_WORK");
  const child = delegate(store, root);
  expectCode(() => update(store, root, [{ op: "block", id: "work", status: "completed" }, { op: "finish", status: "completed" }]), "UNFINISHED_DELEGATION");
  assert.equal(store.getBlock(root.agentId, "work").status, "active");
  update(store, root, [{ op: "delegation", childAgentId: child.agentId, status: "cancelled" }]);
  expectCode(() => update(store, root, [{ op: "block", id: "work", status: "completed" }, { op: "finish", status: "completed" }]), "UNFINISHED_GOALS");
  update(store, root, [{ op: "block", id: "work", status: "completed", outcome: "Done" }, { op: "goal", id: "g1", status: "completed" }, { op: "finish", status: "completed" }]);
  assert.equal(store.getBlock(root.agentId, "next").status, "cancelled");
  assert.equal(store.getSession(root.sessionId).agents.find(agent => agent.id === root.agentId)?.status, "completed");
  expectCode(() => update(store, root, [{ op: "goal", id: "g1", status: "pending" }]), "AGENT_FINISHED");
});

test("explicit failure closes own work without inferring that descendants stopped", t => {
  const { store } = fixture(t); const root = open(store);
  update(store, root, [{ op: "block", id: "work", title: "Coordinate", status: "active" }]);
  const child = delegate(store, root);
  update(store, child, [{ op: "block", id: "work", title: "Continue independently", status: "active" }]);
  update(store, root, [{ op: "finish", status: "failed" }]);
  assert.equal(store.getBlock(root.agentId, "work").status, "failed");
  assert.equal(store.resume({ handle: child.handle }).status, "running");
});

test("resume stays compact and persistence survives reopening and repeated migrations", t => {
  const f = fixture(t); const root = open(f.store);
  const details = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, action: `Step ${i}`, reference: `test/check-${i}.ts` }));
  update(f.store, root, [{ op: "block", id: "work", title: "Current", status: "active", details }]);
  migrateDatabase(f.path);
  const reader = f.connect(true);
  const resumed = reader.resume({ handle: root.handle });
  assert.equal(resumed.revision, 1); assert.equal(resumed.active?.details.length, 3);
  assert.equal(resumed.active?.details[0]?.id, "d5");
  assert.equal(resumed.active?.details[0]?.reference, "test/check-5.ts");
  assert(!JSON.stringify(reader.getSession(root.sessionId)).includes(root.handle));
  assert(!("createdAt" in resumed.active!));
  expectCode(() => update(reader, root, [{ op: "goal", id: "g1", status: "completed" }]), "READ_ONLY");
  assert.equal(f.connect().getBlock(root.agentId, "work").detailCount, 8);
});

test("compact resume prioritizes unfinished children over older completed contributions", t => {
  const { store } = fixture(t); const root = open(store, false);
  update(store, root, [{ op: "block", id: "work", title: "Coordinate contributions", status: "active" }]);
  for (let index = 0; index < 21; index++) {
    const child = delegate(store, root);
    update(store, child, [{ op: "finish", status: "completed" }]);
  }
  const reserved = delegate(store, root);
  const running = delegate(store, root);
  update(store, running, [{ op: "block", id: "work", title: "Still working", status: "active" }]);
  const resumed = store.resume({ handle: root.handle });
  assert.equal(resumed.children.length, 20);
  assert(resumed.children.slice(0, 2).some(child => child.id === reserved.agentId));
  assert(resumed.children.slice(0, 2).some(child => child.id === running.agentId));
  assert.equal(store.getSession(root.sessionId).agents.length, 24);
});

test("long histories are paginated without a twelve-block cap and future proposals stay separate", t => {
  const { store } = fixture(t); const root = open(store, false);
  for (let i = 0; i < 41; i++) update(store, root, [
    { op: "block", id: `b${i}`, title: `Phase ${i}`, status: "active" },
    { op: "block", id: `b${i}`, status: "completed" },
  ]);
  update(store, root, [{ op: "block", id: "future", title: "A tentative next step" }]);
  const first = store.listBlocks(root.agentId, 30, 0, "history");
  const second = store.listBlocks(root.agentId, 30, Number(first.nextCursor), "history");
  assert.equal(first.items.length, 30); assert.equal(second.items.length, 11);
  assert.equal(new Set([...first.items, ...second.items].map(b => b.id)).size, 41);
  assert.equal(store.listBlocks(root.agentId, 30, 0, "proposed").items[0]?.id, "future");
});

test("independent SQLite writer processes can report simultaneously while API connections read", async t => {
  const f = fixture(t); const reader = f.connect(true);
  const writers: Writer[] = [];
  for (let index = 0; index < 2; index++) {
    const root = open(f.store, false);
    update(f.store, root, [{ op: "block", id: "work", title: "Coordinate", status: "active" }]);
    writers.push(root, delegate(f.store, root), delegate(f.store, root));
  }
  const worker = fileURLToPath(new URL("./concurrent-worker.mjs", import.meta.url));
  const jobs = writers.map(identity => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [worker, f.path, JSON.stringify(identity)], { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", chunk => { errors += String(chunk); });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(errors || `Worker exited ${code}`)));
  }));
  const reads = setInterval(() => { assert.equal(reader.listSessions().items.length, 2); }, 10);
  try { await Promise.all(jobs); } finally { clearInterval(reads); }
  for (const writer of writers) assert.equal(reader.resume({ handle: writer.handle }).revision, writer.revision + 12);
});
