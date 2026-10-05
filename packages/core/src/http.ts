/** Services are intentionally personal and loopback-only in v1. */
export function isLocalUrl(value: string): boolean {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname); }
  catch { return false; }
}
