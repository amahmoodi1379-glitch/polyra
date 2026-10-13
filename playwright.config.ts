import "dotenv/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./tests/e2e/database";

const port = Number(process.env.E2E_PORT ?? 3100);

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
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run start -- --port ${port}`,
    port,
    // Always our own server, so it is surely connected to the browser-test database.
    reuseExistingServer: false,
    // Recordings the tests upload go to a scratch folder, not the development uploads.
    env: { DATABASE_URL: e2eDatabaseUrl(), SMS_PROVIDER: "mock", STORAGE_DIR: join(tmpdir(), "polyra-e2e-storage") },
    timeout: 120_000,
  },
});
