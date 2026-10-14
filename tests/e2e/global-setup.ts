import { execSync } from "node:child_process";
import { e2eDatabaseUrl, learnerDatabaseUrl } from "./database";

/** Migrates and refills the browser-test databases (panel and learner) before the app servers are used. */
export default function setup() {
  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl() };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx tests/e2e/prepare-db.ts", { stdio: "inherit", env });
  const learner = { ...process.env, DATABASE_URL: learnerDatabaseUrl() };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: learner });
  execSync("npx tsx tests/e2e/prepare-learner-db.ts", { stdio: "inherit", env: learner });
}
