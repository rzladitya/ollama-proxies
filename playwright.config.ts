import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:11435",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node apps/server/dist/main.js",
    url: "http://127.0.0.1:11435/health/live",
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
