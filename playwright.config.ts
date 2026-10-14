import "dotenv/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl, learnerDatabaseUrl } from "./tests/e2e/database";

const port = Number(process.env.E2E_PORT ?? 3100);
// The learner app runs on a second server with its own database and the French demo.
const learnerPort = port + 1;
const learnerTests = /learner\.spec\.ts$/;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    trace: "retain-on-failure",
    // Lets a machine with a preinstalled Chromium run the tests without downloading browsers.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "phone", testIgnore: learnerTests, use: { ...devices["Pixel 7"] } },
    { name: "desktop", testIgnore: learnerTests, use: { ...devices["Desktop Chrome"] } },
    { name: "learner-phone", testMatch: learnerTests, use: { ...devices["Pixel 7"], baseURL: `http://localhost:${learnerPort}` } },
    { name: "learner-desktop", testMatch: learnerTests, use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${learnerPort}` } },
  ],
  webServer: [
    {
      command: `npm run start -- --port ${port}`,
      port,
      // Always our own server, so it is surely connected to the browser-test database.
      reuseExistingServer: false,
      // Recordings the tests upload go to a scratch folder, not the development uploads.
      env: { DATABASE_URL: e2eDatabaseUrl(), SMS_PROVIDER: "mock", STORAGE_DIR: join(tmpdir(), "polyra-e2e-storage") },
      timeout: 120_000,
    },
    {
      command: `npm run start -- --port ${learnerPort}`,
      port: learnerPort,
      reuseExistingServer: false,
      env: { DATABASE_URL: learnerDatabaseUrl(), SMS_PROVIDER: "mock", STORAGE_DIR: join(tmpdir(), "polyra-e2e-learner-storage") },
      timeout: 120_000,
    },
  ],
});
