import type { AgentOverview, Block } from "@aoverview/core/contracts";

export const BLOCK_WIDTH = 280;
export const BLOCK_HEIGHT = 220;
export const DELEGATE_HEIGHT = 184;

export type GraphItem = {
  id: string; position: { x: number; y: number };
} & ({ kind: "block"; block: Block } | { kind: "delegate"; agent: AgentOverview });
export interface GraphLink {
  id: string; source: string; target: string;
  kind: "sequence" | "proposal" | "delegation" | "integration";
}
export const blockNodeId = (id: string) => `block:${id}`;

/** Sequence means order of starting work, not a dependency inferred from titles. */
export function buildActivityGraph({ agentId, history, proposed, current, agents }: {
  agentId: string; history: Block[]; proposed: Block[]; current: Block | null; agents: AgentOverview[];
}) {
  const started = new Map(history.filter(block => block.agentId === agentId && block.startedAt !== null)
    .map(block => [block.id, block]));
  // The overview can arrive before the paginated history catches up to a live change.
  if (current?.agentId === agentId) started.set(current.id, current);
  const blocks = [...started.values()].sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt)
    || a.position - b.position || a.id.localeCompare(b.id));
  const future = [...new Map(proposed.filter(block => block.agentId === agentId && block.status === "proposed"
    && !started.has(block.id)).map(block => [block.id, block])).values()]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const children = new Map(blocks.map(block => [block.id, agents
    .filter(agent => agent.parentAgentId === agentId && agent.parentBlockId === block.id)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))]));
  const rowHeight = (id: string) => Math.max(BLOCK_HEIGHT + 100, (children.get(id)?.length ?? 0) * (DELEGATE_HEIGHT + 40) + 48);
  let nextY = 128;
  const nodes: GraphItem[] = blocks.map(block => {
    const node: GraphItem = { id: blockNodeId(block.id), kind: "block", block, position: { x: 128, y: nextY } };
    nextY += rowHeight(block.id);
    return node;
  });
  const links: GraphLink[] = blocks.slice(1).map((block, index) => ({
    id: `sequence:${blocks[index]!.id}:${block.id}`, kind: "sequence",
    source: blockNodeId(blocks[index]!.id), target: blockNodeId(block.id),
  }));
  // Future intentions branch from the current activity, or from the last started block.
  // They are never linked to each other as though their execution were already certain.
  const anchor = nodes.find(node => node.id === blockNodeId(current?.id ?? "")) ?? nodes.at(-1);
  future.forEach((block, index) => {
    const node: GraphItem = { id: blockNodeId(block.id), kind: "block", block,
      position: { x: anchor?.position.x ?? 128,
        y: (anchor ? anchor.position.y + rowHeight(anchor.kind === "block" ? anchor.block.id : "") : 128) + index * (BLOCK_HEIGHT + 100) } };
    nodes.push(node);
    if (anchor) links.push({ id: `proposal:${anchor.id}:${node.id}`, kind: "proposal", source: anchor.id, target: node.id });
  });
  for (const block of blocks) {
    const parent = nodes.find(node => node.id === blockNodeId(block.id))!;
    children.get(block.id)!.forEach((agent, index) => {
        const id = `delegate:${agent.id}`;
        nodes.push({ id, kind: "delegate", agent,
          position: { x: parent.position.x + BLOCK_WIDTH + 96, y: parent.position.y + 24 + index * (DELEGATE_HEIGHT + 40) } });
        links.push({ id: `delegation:${agent.id}`, kind: "delegation", source: parent.id, target: id });
        // Integration is a distinct observed relationship; completion alone is insufficient.
        if (agent.integratedAt && agent.integratedIntoBlockId && started.has(agent.integratedIntoBlockId)) {
          links.push({ id: `integration:${agent.id}`, kind: "integration", source: id, target: blockNodeId(agent.integratedIntoBlockId) });
        }
      });
  }
  return { nodes, links, blocks, future, focusId: current ? blockNodeId(current.id) : blocks.at(-1) ? blockNodeId(blocks.at(-1)!.id) : nodes[0]?.id };
}
