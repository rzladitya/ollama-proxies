import { defineConfig } from "@playwright/test";
import { config as dotenvConfig } from "dotenv";

// The suite authenticates against the same admin secret the server loads, so
// read the same .env rather than duplicating it.
dotenvConfig();

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  // Shared server state (accounts, keys, the brute-force counter) makes parallel
  // runs interfere with each other.
  workers: 1,
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
