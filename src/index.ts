import server from "./server.js";

const { url } = await server.listen(undefined, { host: "127.0.0.1" });
console.log(`MCP: ${url}`);
console.log(`API: ${new URL("/api/hello", url).href}`);
