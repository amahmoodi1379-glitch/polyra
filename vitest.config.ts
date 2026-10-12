import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // One database for all integration files, so they run one after another.
          fileParallelism: false,
          env: { DATABASE_URL: testDatabaseUrl, AUTH_SECRET: "test-secret", SMS_PROVIDER: "mock" },
        },
      },
    ],
  },
});
