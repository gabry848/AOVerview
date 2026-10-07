import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { configuredPort } from "@aoverview/core/config";
import { isLocalUrl } from "@aoverview/core";
import { fileURLToPath } from "node:url";

const app = new Hono();
const apiPort = configuredPort("AOVERVIEW_API_PORT", 3002);
const publicRoot = fileURLToPath(new URL("../dist/", import.meta.url));
app.use("*", async (c, next) => {
  if (!isLocalUrl(c.req.url)) return c.text("Local dashboard only.", 403);
  await next();
});
app.all("/api/*", async c => {
  try {
    const upstream = new URL(c.req.url);
    upstream.protocol = "http:"; upstream.hostname = "127.0.0.1"; upstream.port = String(apiPort);
    const headers = new Headers();
    for (const name of ["Last-Event-ID", "Origin", "Sec-Fetch-Site"]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    const response = await fetch(upstream, { method: c.req.method, headers, signal: c.req.raw.signal });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch { return c.json({ error: "UNAVAILABLE", message: "API unavailable." }, 503); }
});
app.use("/assets/*", async (c, next) => { c.header("Cache-Control", "public, max-age=31536000, immutable"); await next(); });
app.use("*", serveStatic({ root: publicRoot }));
app.get("/assets/*", c => {
  c.header("Cache-Control", "no-store");
  return c.text("Asset not found.", 404);
});
app.get("*", serveStatic({ path: `${publicRoot}/index.html` }));
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: configuredPort("AOVERVIEW_DASHBOARD_PORT", 3000) },
  info => console.log(`Dashboard: http://localhost:${info.port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.close(() => process.exit(0));
  if ("closeAllConnections" in server) server.closeAllConnections();
});
