import { OverviewStore } from "@aoverview/core";
import { configuredPort, databasePath } from "@aoverview/core/config";
import { createMcpServer } from "./server.js";

const store = new OverviewStore(databasePath);
const server = createMcpServer(store);
const { url } = await server.listen(configuredPort("AOVERVIEW_MCP_PORT", 3001), { host: "127.0.0.1" });
console.log(`MCP: ${url}`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  store.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void close().then(() => process.exit(0)); });
