/** The browser tests run the app against their own database, never the development one. */
export function e2eDatabaseUrl() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL or TEST_DATABASE_URL is not set (see .env.example)");
  if (!/test|e2e/.test(new URL(url).pathname)) throw new Error("The browser-test database name must contain 'test' or 'e2e'");
  return url;
}

/**
 * The learner tests run on their own server and database with the French demo, so the demo words never
 * meet the content the panel tests make (`<e2e database>_learner`).
 */
export function learnerDatabaseUrl() {
  const url = new URL(e2eDatabaseUrl());
  url.pathname = `${url.pathname}_learner`;
  return url.toString();
}

/** Tester accounts of the learner database: one per browser project. */
export const E2E_TESTERS = { "learner-phone": "09120000031", "learner-desktop": "09120000033" } as const;

/**
 * Admin accounts created by prepare-db: one per browser project, and one each for the order, publish,
 * audio, settings, errors and users tests, since a phone may ask for only 3 codes in 10 minutes (PRD §15.5).
 */
export const E2E_ADMINS = {
  phone: "09120000001",
  desktop: "09120000003",
  order: "09120000005",
  publish: "09120000007",
  audio: "09120000009",
  settings: "09120000011",
  errors: "09120000013",
  users: "09120000015",
} as const;

/** The French frequency list of the browser-test database (prepare-db). */
export const E2E_FREQUENCY = ["être", "maison", "une", "manger", "petit", "aller"] as const;
