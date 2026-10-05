import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (existsSync(resolve(root, ".env"))) loadEnvFile(resolve(root, ".env"));
const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") throw new Error("Expected dev or start.");

function once(command, args) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: "inherit", cwd: root });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? done() : reject(new Error(`${command} exited with ${code}`)));
  });
}

if (mode === "dev") await once("npm", ["run", "build", "-w", "@aoverview/core"]);
else for (const file of ["packages/core/dist/migrate.js", "apps/mcp/dist/index.js", "apps/api/dist/index.js", "apps/dashboard/dist-server/server.js"]) {
  if (!existsSync(resolve(root, file))) throw new Error("Build missing. Run npm run build before npm start.");
}
await once(process.execPath, ["packages/core/dist/migrate.js"]);

const workers = [];
let stopping = false;
let exitCode = 0;
function killGroup(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== "ESRCH") console.error(error.message); }
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true; exitCode = code;
  for (const worker of workers) killGroup(worker, "SIGTERM");
  setTimeout(() => {
    for (const worker of workers) killGroup(worker, "SIGKILL");
    process.exit(exitCode);
  }, 2000);
}
const packages = mode === "dev" ? ["core", "mcp", "api", "dashboard"] : ["mcp", "api", "dashboard"];
for (const name of packages) {
  const child = spawn("npm", ["run", mode, "-w", `@aoverview/${name}`], {
    // Only the launcher owns the terminal input; competing watchers must not
    // switch its raw mode or consume Ctrl-C as a restart keystroke.
    stdio: ["ignore", "inherit", "inherit"], cwd: root, detached: process.platform !== "win32", env: process.env,
  });
  workers.push(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code || 1); });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => stop(0));
process.once("exit", () => {
  for (const worker of workers) killGroup(worker, "SIGKILL");
});
