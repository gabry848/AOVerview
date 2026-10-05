import { MCPServer } from "mcp-use";
import { OverviewError, OverviewStore, openSchema, registerSchema, resumeSchema, updateSchema } from "@aoverview/core";

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
    description: "Report agent goals, macro activities, outcomes and delegations to a local dashboard.",
    instructions: "Report meaningful macro progress, not individual tool calls. Batch related changes. Preserve your writer handle and revision. Register each subagent before spawning it and pass its handle plus the AOVerview skill. Proposed blocks are tentative. Resume after context loss or revision conflicts.",
    logging: { enabled: false },
    allowedOrigins: [],
    skills: false,
  });
  server.tool({
    name: "overview_open", description: "Open an independent session. Use a globally unique requestId; reuse it only to retry this exact request.",
    inputSchema: openSchema,
  }, async input => respond(() => store.open(input)));
  server.tool({
    name: "overview_update", description: "Atomically report only changed goals, blocks, details, delegation integration or agent completion. One active block per agent. Short IDs are scoped to your agent. Omitted fields are preserved; null clears optional text.",
    inputSchema: updateSchema,
  }, async input => respond(() => store.update(input)));
  server.tool({
    name: "overview_register_subagent", description: "Reserve a child from your active delegation block before spawning it. Pass the returned child handle and reporting skill to the subagent. Use the returned parent revision for your next update.",
    inputSchema: registerSchema,
  }, async input => respond(() => store.registerSubagent(input)));
  server.tool({
    name: "overview_resume", description: "Recover compact reporting context and current revision after compaction, restart or a revision conflict. Does not change state.",
    inputSchema: resumeSchema,
    annotations: { readOnlyHint: true },
  }, async input => respond(() => store.resume(input)));
  return server;
}
