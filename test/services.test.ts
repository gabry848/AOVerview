import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { OpenResult, RegisterResult, ResumeResult, WriteResult } from "@aoverview/core";
import { createApiApp } from "../apps/api/src/app.js";
import { createMcpServer } from "../apps/mcp/src/server.js";
import { delegate, fixture, open, update } from "./helpers.js";

test("API provides paginated read-only snapshots and never exposes writer handles", async t => {
  const f = fixture(t); const reader = f.connect(true);
  const api = createApiApp(reader); t.after(api.close);
  const identity = open(f.store);
  update(f.store, identity, [{ op: "block", id: "work", title: "Current activity", status: "active",
    details: [{ id: "d1", action: "Defined the contract", result: "Consistent fields", reference: "src/contracts.ts" }] }]);
  const request = (url: string, init?: RequestInit) => api.app.request(url, init);
  assert.equal((await request("/health")).status, 200);
  const list = await (await request("/api/v1/sessions?limit=1")).json();
  assert.equal(list.items[0].currentBlock.title, "Current activity");
  assert.equal(list.items[0].detailLevel, "medium");
  const snapshot = await (await request(`/api/v1/sessions/${identity.sessionId}`)).text();
  assert(!snapshot.includes(identity.handle)); assert(!snapshot.includes('"handle"'));
  assert.equal(JSON.parse(snapshot).session.detailLevel, "medium");
  const detail = await (await request(`/api/v1/agents/${identity.agentId}/blocks/work`)).json();
  assert.equal(detail.details[0].result, "Consistent fields");
  assert.equal(detail.details[0].reference, "src/contracts.ts");
  assert.equal((await request("/api/v1/sessions?limit=1000")).status, 400);
  assert.equal((await request("/api/v1/sessions?cursor=invalid")).status, 400);
  assert.equal((await request(`/api/v1/agents/${identity.agentId}/blocks?view=unknown`)).status, 400);
  assert.equal((await request("/api/v1/sessions/missing")).status, 404);
  assert.equal((await request("/api/v1/sessions", { method: "POST" })).status, 404);
  assert.equal((await request("http://foreign.invalid/api/v1/sessions")).status, 403);
  assert.equal(f.store.latestSequence(), 2);
});

test("API archives and restores sessions, notifies readers and rejects foreign writes", async t => {
  const f = fixture(t); const root = open(f.store); const other = open(f.store, false);
  const api = createApiApp(f.store); t.after(api.close);
  const url = `/api/v1/sessions/${root.sessionId}/archive`;
  const sequence = f.store.latestSequence();
  for (const headers of [{ Origin: "https://foreign.invalid" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await api.app.request(url, { method: "POST", headers })).status, 403);
    assert.equal((await api.app.request(url, { method: "DELETE", headers })).status, 403);
  }
  assert.equal(f.store.latestSequence(), sequence);
  assert.equal((await api.app.request("/api/v1/sessions/missing/archive", { method: "POST" })).status, 404);
  assert.equal((await api.app.request("/api/v1/sessions/invalid!/archive", { method: "POST" })).status, 400);
  const response = await api.app.request(url, { method: "POST", headers: { Origin: "http://localhost:3000" } });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert(!body.includes(root.handle)); assert(!body.includes('"handle"'));
  assert.equal(typeof JSON.parse(body).archivedAt, "number");
  assert.equal((await api.app.request(url, { method: "POST" })).status, 200);
  assert.equal(f.store.latestSequence(), sequence + 1);
  const list = await (await api.app.request("/api/v1/sessions?limit=1")).json();
  assert.deepEqual(list.items.map((item: { id: string }) => item.id), [other.sessionId]);
  assert.equal(list.nextCursor, null);
  assert.equal(list.items.reduce((sum: number, item: { openGoals: number }) => sum + item.openGoals, 0), 0);
  const snapshot = await (await api.app.request(`/api/v1/sessions/${root.sessionId}`)).json();
  assert.equal(snapshot.session.archivedAt, JSON.parse(body).archivedAt);
  assert.equal((await api.app.request(url, { method: "DELETE" })).status, 200);
  assert.equal(f.store.latestSequence(), sequence + 2);
  const restored = await (await api.app.request("/api/v1/sessions")).json();
  assert.equal(restored.items.length, 2);
  assert.equal(restored.items.find((item: { id: string }) => item.id === root.sessionId).archivedAt, null);
});

test("SSE delivers writes from another connection and replays or resets reconnect cursors", async t => {
  const f = fixture(t); const api = createApiApp(f.connect(true), 20);
  const server = serve({ fetch: api.app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();
  t.after(() => {
    controller.abort(); api.close(); server.close();
    if ("closeAllConnections" in server) server.closeAllConnections();
  });
  const response = await fetch(`${base}/api/v1/events`, { signal: controller.signal });
  assert.match(response.headers.get("Content-Type")!, /text\/event-stream/);
  const stream = response.body!.getReader();
  const decoder = new TextDecoder(); let buffer = "";
  async function until(value: string) {
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      while (!buffer.includes(value)) {
        const chunk = await stream.read();
        assert(!chunk.done); buffer += decoder.decode(chunk.value, { stream: true });
      }
      return buffer;
    } finally { clearTimeout(timeout); }
  }
  await until("event: ready");
  const root = open(f.store);
  const received = await until(root.sessionId);
  assert.match(received, /event: change/); assert(!received.includes(root.handle));
  const lastSequence = f.store.latestSequence();
  update(f.store, root, [{ op: "block", id: "work", title: "New activity", status: "active" }]);
  controller.abort();

  const reconnect = new AbortController();
  try {
    const replay = await fetch(`${base}/api/v1/events`, { headers: { "Last-Event-ID": String(lastSequence) }, signal: reconnect.signal });
    const reader = replay.body!.getReader(); let text = "";
    const timeout = setTimeout(() => reconnect.abort(), 4000);
    try { while (!text.includes("event: change")) { const part = await reader.read(); assert(!part.done); text += decoder.decode(part.value); } }
    finally { clearTimeout(timeout); }
    assert(text.includes(`id: ${lastSequence + 1}`));
  } finally { reconnect.abort(); }
  const resetController = new AbortController();
  try {
    const reset = await fetch(`${base}/api/v1/events`, { headers: { "Last-Event-ID": "999999" }, signal: resetController.signal });
    const first = await reset.body!.getReader().read();
    assert.match(decoder.decode(first.value), /event: reset/);
  } finally { resetController.abort(); }
});

test("SSE publishes archive changes to another open dashboard", async t => {
  const f = fixture(t); const root = open(f.store);
  const api = createApiApp(f.connect(), 20);
  const server = serve({ fetch: api.app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();
  t.after(() => {
    controller.abort(); api.close(); server.close();
    if ("closeAllConnections" in server) server.closeAllConnections();
  });
  const response = await fetch(`${base}/api/v1/events`, { signal: controller.signal });
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  const sequence = f.store.latestSequence();
  assert.equal((await fetch(`${base}/api/v1/sessions/${root.sessionId}/archive`, { method: "POST" })).status, 200);
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    let received = "";
    while (!received.includes("event: change")) {
      const part = await reader.read(); assert(!part.done);
      received += new TextDecoder().decode(part.value);
    }
    assert(received.includes(`id: ${sequence + 1}`));
    assert(received.includes(root.sessionId));
    assert.equal(f.connect(true).listSessions().items.length, 0);
  } finally { clearTimeout(timeout); }
});

test("home counts unfinished goals and blocked activities across parent and subagents", async t => {
  const f = fixture(t); const root = open(f.store); const other = open(f.store, false);
  update(f.store, root, [
    { op: "goal", id: "g1", status: "blocked" },
    { op: "goal", id: "g2", title: "Still in progress", status: "active" },
    { op: "goal", id: "g3", title: "Already delivered", status: "completed" },
    { op: "goal", id: "g4", title: "Removed from scope", status: "cancelled" },
    { op: "block", id: "work", title: "Coordinate work", status: "active" },
  ]);
  const child = delegate(f.store, root);
  update(f.store, child, [{ op: "block", id: "work", title: "Inspect a dependency", status: "active" },
    { op: "block", id: "work", status: "blocked", concern: "Waiting for a dependency" }]);
  update(f.store, root, [{ op: "block", id: "work", status: "blocked", concern: "Needs a decision" }]);
  const api = createApiApp(f.connect(true)); t.after(api.close);
  const list = await (await api.app.request("/api/v1/sessions")).json();
  const main = list.items.find((item: { id: string }) => item.id === root.sessionId);
  const unrelated = list.items.find((item: { id: string }) => item.id === other.sessionId);
  assert.equal(main.openGoals, 2); assert.equal(main.completedGoals, 1); assert.equal(main.totalGoals, 4);
  assert.equal(main.blockedCount, 2); assert.equal(main.runningCount, 2); assert.equal(main.workingCount, 0);
  assert.equal(unrelated.openGoals, 0); assert.equal(unrelated.blockedCount, 0);
  update(f.store, child, [{ op: "block", id: "work", status: "active" }]);
  const refreshed = await (await api.app.request("/api/v1/sessions")).json();
  const active = refreshed.items.find((item: { id: string }) => item.id === root.sessionId);
  assert.equal(active.blockedCount, 1); assert.equal(active.workingCount, 1);
});

test("real MCP clients open two sessions, delegate, report progress, integrate and resume", async t => {
  const f = fixture(t); const server = createMcpServer(f.store);
  const { url } = await server.listen(0, { host: "127.0.0.1" });
  const client = new Client({ name: "aoverview-integration", version: "1.0.0" }, { capabilities: {}, versionNegotiation: { mode: "auto" } });
  t.after(async () => { await client.close(); await server.close(); });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["overview_open", "overview_register_subagent", "overview_resume", "overview_update"]);
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result.content));
    return result.structuredContent as T;
  }
  const root = await call<OpenResult>("overview_open", { requestId: randomUUID(), title: "First session", agentName: "Main", detailLevel: "high", goals: [{ id: "g1", title: "Working dashboard" }] });
  const other = await call<OpenResult>("overview_open", { requestId: randomUUID(), title: "Second session", agentName: "Other" });
  assert.notEqual(root.sessionId, other.sessionId);
  assert.equal(root.detailLevel, "high"); assert.equal(other.detailLevel, "medium");
  const report = { handle: root.handle, requestId: "start", expectedRevision: 0,
    operations: [{ op: "block", id: "work", title: "Coordinate the implementation", status: "active", goalId: "g1" }] };
  const ack = await call<WriteResult>("overview_update", report);
  assert.deepEqual(await call("overview_update", report), ack);
  const registered = await call<RegisterResult>("overview_register_subagent", { handle: root.handle, requestId: "delegate", expectedRevision: ack.revision,
    blockId: "work", name: "Reviewer", mandate: "Verify the implementation" });
  assert.equal(registered.child.detailLevel, "high");
  assert.equal((await call<ResumeResult>("overview_resume", { handle: registered.child.handle })).detailLevel, "high");
  await call("overview_update", { handle: registered.child.handle, requestId: "result", expectedRevision: 0,
    operations: [{ op: "block", id: "work", title: "Verify the implementation", status: "active", details: [{ id: "d1", action: "Checked the reporting flow", result: "Passed", reference: "npm test" }] },
      { op: "block", id: "work", status: "completed", outcome: "Verified" }, { op: "finish", status: "completed" }] });
  assert.equal(f.store.getBlock(registered.child.agentId, "work").details[0]?.reference, "npm test");
  await call("overview_update", { handle: root.handle, requestId: "integrate", expectedRevision: registered.revision,
    operations: [{ op: "delegation", childAgentId: registered.child.agentId, status: "integrated", blockId: "work" },
      { op: "block", id: "work", status: "completed", outcome: "Integrated the verified contribution" },
      { op: "goal", id: "g1", status: "completed" }, { op: "finish", status: "completed" }] });
  const resumed = await call<ResumeResult>("overview_resume", { handle: root.handle });
  assert.equal(resumed.status, "completed"); assert.equal(resumed.revision, 3);
  assert.equal(resumed.detailLevel, "high");
  const conflict = await client.callTool({ name: "overview_update", arguments: { handle: other.handle, requestId: "stale", expectedRevision: 99,
    operations: [{ op: "block", id: "bad", title: "Must not exist", status: "active" }] } });
  assert.equal(conflict.isError, true);
  assert.match(JSON.stringify(conflict.content), /REVISION_CONFLICT/);
  assert.equal(f.store.listBlocks(other.agentId).items.length, 0);
});
