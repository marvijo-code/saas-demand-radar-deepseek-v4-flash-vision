import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.join(os.tmpdir(), "sdr-e2e.db");

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "./test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: `rm -f "${dbPath}" "${dbPath}-wal" "${dbPath}-shm" && npm run api`,
      url: "http://127.0.0.1:4174/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: repoRoot,
      env: {
        PORT: "4174",
        DATABASE_PATH: dbPath,
        REFERENCE_TIME: "2026-06-14T00:00:00Z",
      },
    },
    {
      command: "npm run web:dev",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: repoRoot,
    },
  ],
});
