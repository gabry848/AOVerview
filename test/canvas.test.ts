import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentOverview, Block } from "@aoverview/core/contracts";
import { BLOCK_WIDTH, DELEGATE_HEIGHT, buildActivityGraph } from "../apps/dashboard/src/components/activity-graph.js";

function block(id: string, overrides: Partial<Block> = {}): Block {
  return { id, agentId: "root", goalId: null, title: id, summary: null, status: "completed",
    outcome: null, concern: null, position: 0, createdAt: 1, updatedAt: 1, startedAt: 1,
    endedAt: 2, detailCount: 0, ...overrides };
}
function child(id: string, overrides: Partial<AgentOverview> = {}): AgentOverview {
  return { id, sessionId: "session", parentAgentId: "root", parentBlockId: "work", goalId: null,
    name: id, mandate: "Review the work", status: "completed", revision: 1, createdAt: 1,
    updatedAt: 2, endedAt: 2, integratedAt: null, integratedIntoBlockId: null, integrationNote: null,
    currentBlock: null, proposedCount: 0, ...overrides };
}

test("canvas orders actual starts and reconciles a current block arriving before its history page", () => {
  const current = block("current", { startedAt: 30, status: "active", endedAt: null });
  const graph = buildActivityGraph({ agentId: "root", current, agents: [], history: [
    block("second", { startedAt: 20, position: 1 }), block("first", { startedAt: 10, position: 8 }),
    block("foreign", { agentId: "another-agent" }), block("cancelled-intention", { status: "cancelled", startedAt: null }),
  ], proposed: [
    block("current", { status: "proposed", startedAt: null }),
    block("maybe-one", { status: "proposed", startedAt: null, position: 9 }),
    block("maybe-two", { status: "proposed", startedAt: null, position: 10 }),
  ] });
  assert.deepEqual(graph.blocks.map(item => item.id), ["first", "second", "current"]);
  assert.equal(new Set(graph.nodes.map(item => item.id)).size, graph.nodes.length);
  assert.deepEqual(graph.links.map(link => [link.kind, link.source, link.target]), [
    ["sequence", "block:first", "block:second"], ["sequence", "block:second", "block:current"],
    ["proposal", "block:current", "block:maybe-one"], ["proposal", "block:current", "block:maybe-two"],
  ]);
  assert.equal(graph.focusId, "block:current");
});

test("canvas distinguishes delegation from observed integration and omits unloaded parent relationships", () => {
  const options = { agentId: "root", current: null, proposed: [], history: [block("work"), block("use-result", { startedAt: 3 })],
    agents: [child("reviewer"), child("hidden-parent", { parentBlockId: "outside-this-page" }),
      child("another-agent-child", { parentAgentId: "another-agent" })] };
  const completed = buildActivityGraph(options);
  assert.deepEqual(completed.nodes.filter(node => node.kind === "delegate").map(node => node.id), ["delegate:reviewer"]);
  assert.equal(completed.links.filter(link => link.kind === "integration").length, 0);
  const integrated = buildActivityGraph({ ...options, agents: [child("reviewer", { integratedAt: 4, integratedIntoBlockId: "use-result" })] });
  assert.deepEqual(integrated.links.filter(link => link.kind === "integration").map(link => [link.source, link.target]),
    [["delegate:reviewer", "block:use-result"]]);
  assert(integrated.links.every(link => integrated.nodes.some(node => node.id === link.source)
    && integrated.nodes.some(node => node.id === link.target)));
});

test("canvas does not imply an execution order between intentions when no work has started", () => {
  const graph = buildActivityGraph({ agentId: "root", current: null, history: [], agents: [],
    proposed: [block("one", { status: "proposed", startedAt: null }), block("two", { status: "proposed", startedAt: null })] });
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.links.length, 0);
});

test("canvas stacks work vertically and leaves space for each block's delegated agents", () => {
  const graph = buildActivityGraph({ agentId: "root", current: null, proposed: [],
    history: [block("first"), block("second", { startedAt: 3 })],
    agents: [child("one", { parentBlockId: "first" }), child("two", { parentBlockId: "first" }),
      child("three", { parentBlockId: "first" })] });
  const first = graph.nodes.find(node => node.id === "block:first")!;
  const second = graph.nodes.find(node => node.id === "block:second")!;
  assert.equal(first.position.x, second.position.x);
  assert(first.position.y < second.position.y);
  const delegates = graph.nodes.filter(node => node.kind === "delegate");
  assert(delegates.every(node => node.position.x >= first.position.x + BLOCK_WIDTH));
  assert(delegates.every(node => node.position.y + DELEGATE_HEIGHT < second.position.y));
  for (let index = 1; index < delegates.length; index++) {
    assert(delegates[index]!.position.y >= delegates[index - 1]!.position.y + DELEGATE_HEIGHT);
  }
});

test("only execution links animate; intentions, blocked work and completed contributions stay still", () => {
  const current = block("work", { status: "active", endedAt: null, startedAt: 3 });
  const options = { agentId: "root", current, history: [block("first")],
    proposed: [block("maybe", { status: "proposed", startedAt: null })],
    agents: [child("working", { status: "running", currentBlock: block("check", { status: "active" }) }),
      child("reserved", { status: "reserved" }), child("completed", { integratedAt: 4, integratedIntoBlockId: "work" })] };
  const graph = buildActivityGraph(options);
  assert.deepEqual(graph.links.filter(link => link.animated).map(link => link.id), ["sequence:first:work", "delegation:working"]);
  const paused = buildActivityGraph({ ...options, current: { ...current, status: "blocked" },
    agents: [child("working", { status: "running", currentBlock: block("check", { status: "blocked" }) })] });
  assert(paused.links.every(link => !link.animated));
  const completed = buildActivityGraph({ ...options, current: null,
    history: [...options.history, { ...current, status: "completed", endedAt: 6 }], agents: [child("working")] });
  assert(completed.links.every(link => !link.animated));
});
