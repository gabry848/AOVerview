import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

async function freePorts() {
  const reservations = Array.from({ length: 3 }, () => createServer());
  try {
    await Promise.all(reservations.map(server => new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))));
    return reservations.map(server => {
      const address = server.address(); assert(address && typeof address === "object");
      return address.port;
    });
  } finally {
    await Promise.all(reservations.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  }
}

test("development launcher starts the services and releases every port after SIGINT", { timeout: 25000 }, async t => {
  const [dashboard, mcp, api] = await freePorts();
  const dir = mkdtempSync(join(tmpdir(), "aoverview-launcher-"));
  const child = spawn(process.execPath, ["scripts/run.mjs", "dev"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AOVERVIEW_DB_PATH: join(dir, "overview.sqlite"),
      AOVERVIEW_DASHBOARD_PORT: String(dashboard), AOVERVIEW_MCP_PORT: String(mcp), AOVERVIEW_API_PORT: String(api) },
  });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) stream!.on("data", chunk => { logs = (logs + String(chunk)).slice(-4000); });
  const exited = new Promise<number | null>(resolve => child.once("exit", resolve));
  t.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
    rmSync(dir, { recursive: true, force: true });
  });
  const urls = [`http://127.0.0.1:${dashboard}`, `http://127.0.0.1:${mcp}/mcp`, `http://127.0.0.1:${api}/health`];
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const responses = await Promise.all(urls.map(url => fetch(url, { signal: AbortSignal.timeout(500) })));
      ready = responses[0]!.ok && responses[2]!.ok;
      await Promise.all(responses.map(response => response.body?.cancel()));
      if (ready) break;
    } catch { /* Wait for all services to bind. */ }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert(ready, logs);
  child.kill("SIGINT");
  assert.equal(await exited, 0, logs);
  for (const url of urls) {
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(500) }), `A service remained active: ${url}`);
  }
});
