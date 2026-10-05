import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const env = { ...loadEnv(mode, root, "AOVERVIEW_"), ...process.env };
  const apiPort = Number(env.AOVERVIEW_API_PORT ?? 3002);
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1", port: Number(env.AOVERVIEW_DASHBOARD_PORT ?? 3000), strictPort: true,
      proxy: { "/api": { target: `http://127.0.0.1:${apiPort}` } },
    },
    build: { outDir: "dist" },
  };
});
