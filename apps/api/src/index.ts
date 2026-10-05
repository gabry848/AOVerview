import { serve } from "@hono/node-server";
import { OverviewStore } from "@aoverview/core";
import { configuredPort, databasePath } from "@aoverview/core/config";
import { createApiApp } from "./app.js";

const store = new OverviewStore(databasePath, true);
const api = createApiApp(store);
const server = serve({ fetch: api.app.fetch, hostname: "127.0.0.1", port: configuredPort("AOVERVIEW_API_PORT", 3002) },
  info => console.log(`API: http://localhost:${info.port}`));

function close() {
  api.close();
  server.close(() => { store.close(); process.exit(0); });
  if ("closeAllConnections" in server) server.closeAllConnections();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, close);
