import { MCPServer } from "mcp-use";
import {
  OverviewError, OverviewStore, openSchema, registerSchema, resumeSchema, updateSchema,
  listSessionsSchema, getSessionSchema, listBlocksSchema, getBlockSchema,
} from "@aoverview/core";

function respond(operation: () => object) {
  try {
    return { content: [{ type: "text" as const, text: "OK" }],
      structuredContent: operation() as Record<string, unknown> };
  } catch (error) {
    const data = error instanceof OverviewError
      ? { error: error.code, message: error.message, ...(error.revision === undefined ? {} : { revision: error.revision }) }
      : { error: "STORAGE_ERROR", message: "Reporting unavailable. Retry once, then continue the main task." };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  }
}

export function createMcpServer(store: OverviewStore) {
  const server = new MCPServer({
    name: "aoverview", version: "0.1.0", basePath: "/mcp",
    description: "Report and browse macro goals, activity blocks, factual steps and delegations in a local dashboard.",
    instructions: "Set project at session opening to the free-text repository/product name you are working on, without looking up a project catalog. Case, accents, spaces, hyphens and underscores are ignored when grouping. The main agent can change it with a project operation; descendants inherit it. Keep three levels distinct: macro goals, bounded activity blocks, and performed steps with action, result and an observed reference. Several blocks can advance one goal; completing a block does not automatically complete its goal. Follow the session detailLevel: low groups related work, medium separates tasks, high separates meaningful subactivities; never one block per tool call or a fixed block count. Include meaningful steps before closing performed work. Batch only changes. Preserve handle and revision. Register subagents before spawning; pass their handle, inherited detailLevel and AOVerview skill. Proposals are tentative. Resume after context loss or revision conflicts.",
    logging: { enabled: false },
    allowedOrigins: [],
    skills: false,
  });
  server.tool({
    name: "overview_open", description: "Open a session with macro goals, a free-text project name (no catalog lookup), and optional detailLevel low/medium/high (default medium). Project grouping ignores case, accents, spaces, hyphens and underscores. Use a globally unique requestId; reuse it only for an exact retry.",
    inputSchema: openSchema,
  }, async input => respond(() => store.open(input)));
  server.tool({
    name: "overview_update", description: "Atomically report only changed goals, blocks, details, delegation integration or agent completion. The main agent can set the session project with {op: project, name: free-text name} or clear it with name: null. One active block per agent. Short IDs are scoped to your agent. Omitted fields are preserved; null clears optional text.",
    inputSchema: updateSchema,
  }, async input => respond(() => store.update(input)));
  server.tool({
    name: "overview_register_subagent", description: "Reserve a child from your active block before spawning it. Pass the returned child handle, inherited detailLevel and reporting skill to the subagent. Use the returned parent revision for your next update.",
    inputSchema: registerSchema,
  }, async input => respond(() => store.registerSubagent(input)));
  server.tool({
    name: "overview_resume", description: "Recover compact reporting context and current revision after compaction, restart or a revision conflict. Does not change state.",
    inputSchema: resumeSchema,
    annotations: { readOnlyHint: true },
  }, async input => respond(() => store.resume(input)));
  server.tool({
    name: "overview_list_sessions", description: "List non-archived sessions with their current activity and progress counts. Paginated: limit 1–100 (default 30); pass nextCursor as cursor for the next page. Read-only; no writer handle required or returned.",
    inputSchema: listSessionsSchema,
    annotations: { readOnlyHint: true },
  }, async input => respond(() => store.listSessions(input.limit, Number(input.cursor))));
  server.tool({
    name: "overview_get_session", description: "Read a session's goals and agent hierarchy, including agent IDs for browsing activities. Also works for archived sessions by ID. Read-only; no writer handle required or returned.",
    inputSchema: getSessionSchema,
    annotations: { readOnlyHint: true },
  }, async input => respond(() => store.getSession(input.sessionId)));
  server.tool({
    name: "overview_list_blocks", description: "List one agent's activity blocks without full step details. view: all (default, includes cancelled proposals), history (started work, most recent first), or proposed. Paginated: limit 1–100 (default 30); pass nextCursor as cursor. Read-only; no writer handle required or returned.",
    inputSchema: listBlocksSchema,
    annotations: { readOnlyHint: true },
  }, async input => respond(() => store.listBlocks(input.agentId, input.limit, Number(input.cursor), input.view)));
  server.tool({
    name: "overview_get_block", description: "Read a complete activity block with all action/result/reference steps in order. blockId is scoped to agentId; use both IDs from overview_list_blocks. Read-only; no writer handle required or returned.",
    inputSchema: getBlockSchema,
    annotations: { readOnlyHint: true },
  }, async input => respond(() => store.getBlock(input.agentId, input.blockId)));
  return server;
}
