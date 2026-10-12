import { execSync } from "node:child_process";

/** Brings the test database to the latest migration before the integration tests run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  if (!/test/.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
