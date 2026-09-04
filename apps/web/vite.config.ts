import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

// Single source of truth for the version badge — reading it here keeps the UI
// from drifting out of sync with the release, as it had at v1.0 vs 2.0.0.
const rootPkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://127.0.0.1:11435",
      "/api": "http://127.0.0.1:11435",
      "/health": "http://127.0.0.1:11435",
    },
  },
  build: {
    outDir: "dist",
  },
});
