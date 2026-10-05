import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "aoverview",
  version: "0.1.0",
  description: "API e strumenti MCP per AOVerview.",
  basePath: "/mcp",
});

export const helloWorld = server.tool(
  {
    name: "hello-world",
    description: "Return a hello world greeting, optionally addressed to someone.",
    inputSchema: z.object({
      name: z.string().trim().min(1).default("world"),
    }),
    outputSchema: z.object({ message: z.string() }),
  },
  async ({ name }) => {
    const message = `Hello ${name}!`;
    return {
      content: [{ type: "text", text: message }],
      structuredContent: { message },
    };
  },
);

server.get("/api/hello", (context) =>
  context.json({ message: "Hello world!" }),
);

export default server;
