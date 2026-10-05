import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = resolve(projectRoot, ".env");
if (existsSync(envPath)) loadEnvFile(envPath);

export const databasePath = resolve(projectRoot, process.env.AOVERVIEW_DB_PATH ?? "data/aoverview.sqlite");

export function configuredPort(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${key} must be a TCP port between 1 and 65535`);
  }
  return Number(value);
}
