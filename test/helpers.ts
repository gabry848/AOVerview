import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { migrateDatabase, OverviewError, OverviewStore, type Mutation, type OpenResult, type RegisterResult } from "@aoverview/core";
import assert from "node:assert/strict";

export function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "aoverview-test-"));
  const path = join(dir, "overview.sqlite");
  migrateDatabase(path);
  const connections: OverviewStore[] = [];
  function connect(readOnly = false) {
    const store = new OverviewStore(path, readOnly);
    connections.push(store); return store;
  }
  const store = connect();
  t.after(() => { for (const connection of connections) connection.close(); rmSync(dir, { recursive: true, force: true }); });
  return { path, store, connect };
}
export function open(store: OverviewStore, goals = true) {
  return store.open({ requestId: randomUUID(), title: "Implementare la dashboard", agentName: "Principale",
    ...(goals ? { goals: [{ id: "g1", title: "Dashboard funzionante" }] } : {}) });
}
export type Writer = Pick<OpenResult, "handle" | "agentId" | "sessionId" | "revision">;
export function update(store: OverviewStore, writer: Writer, operations: Mutation[], requestId: string = randomUUID()) {
  const result = store.update({ handle: writer.handle, expectedRevision: writer.revision, requestId, operations });
  writer.revision = result.revision; return result;
}
export function delegate(store: OverviewStore, parent: Writer, blockId = "work"): RegisterResult["child"] {
  const result = store.registerSubagent({ handle: parent.handle, expectedRevision: parent.revision,
    requestId: randomUUID(), name: "Specialista", mandate: "Verificare il contributo delegato", blockId });
  parent.revision = result.revision; return result.child;
}
export function expectCode(operation: () => unknown, code: string) {
  assert.throws(operation, error => error instanceof OverviewError && error.code === code);
}
