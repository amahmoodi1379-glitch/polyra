import { execSync } from "node:child_process";
import { e2eDatabaseUrl } from "./database";

/** Migrates and refills the browser-test database before the app server is used. */
export default function setup() {
  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl() };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx tests/e2e/prepare-db.ts", { stdio: "inherit", env });
}
