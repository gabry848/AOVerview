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
    description: "Report macro goals, activity blocks, factual steps and delegations to a local dashboard.",
    instructions: "Keep three levels distinct: macro goals, bounded activity blocks, and performed steps with action, result and an observed reference. Several blocks can advance one goal; completing a block does not automatically complete its goal. Follow the session detailLevel: low groups related work, medium separates tasks, high separates meaningful subactivities; never one block per tool call or a fixed block count. Include meaningful steps before closing performed work. Batch only changes. Preserve handle and revision. Register subagents before spawning; pass their handle, inherited detailLevel and AOVerview skill. Proposals are tentative. Resume after context loss or revision conflicts.",
    logging: { enabled: false },
    allowedOrigins: [],
    skills: false,
  });
  server.tool({
    name: "overview_open", description: "Open a session with macro goals and optional detailLevel low/medium/high (default medium). This guides agent reporting, not a canvas filter. Use a globally unique requestId; reuse it only for an exact retry.",
    inputSchema: openSchema,
  }, async input => respond(() => store.open(input)));
  server.tool({
    name: "overview_update", description: "Atomically report only changed goals, blocks, details, delegation integration or agent completion. One active block per agent. Short IDs are scoped to your agent. Omitted fields are preserved; null clears optional text.",
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
  return server;
}
