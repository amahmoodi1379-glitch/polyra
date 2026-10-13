/** The browser tests run the app against their own database, never the development one. */
export function e2eDatabaseUrl() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL or TEST_DATABASE_URL is not set (see .env.example)");
  if (!/test|e2e/.test(new URL(url).pathname)) throw new Error("The browser-test database name must contain 'test' or 'e2e'");
  return url;
}

/**
 * Admin accounts created by prepare-db: one per browser project, and one each for the order, publish
 * and audio tests, since a phone may ask for only 3 codes in 10 minutes (PRD §15.5).
 */
export const E2E_ADMINS = { phone: "09120000001", desktop: "09120000003", order: "09120000005", publish: "09120000007", audio: "09120000009" } as const;

/** The French frequency list of the browser-test database (prepare-db). */
export const E2E_FREQUENCY = ["être", "maison", "une", "manger", "petit", "aller"] as const;
