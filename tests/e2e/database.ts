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

/** Testers who already know every demo word, so the demo's texts are open to them (PRD §7.5). */
export const E2E_READERS = { "learner-phone": "09120000035", "learner-desktop": "09120000037" } as const;

/** New learners from zero for the phonics lessons (PRD §8): the auto mode on, nothing else met. */
export const E2E_PHONICS = { "learner-phone": "09120000039", "learner-desktop": "09120000041" } as const;

/** Testers who have not started French, for the placement test (PRD §11). */
export const E2E_PLACERS = { "learner-phone": "09120000047", "learner-desktop": "09120000049" } as const;

/** Teachers on the learner server, for «تعیین سطح» on «آزمایش مثل زبان‌آموز» with the French demo. */
export const E2E_TRY_ADMINS = { "learner-phone": "09120000051", "learner-desktop": "09120000053" } as const;

/** Testers at vocabulary B1, so this week's writing is open (PRD §8b.6). */
export const E2E_WRITERS = { "learner-phone": "09120000043", "learner-desktop": "09120000045" } as const;

/** New learners from zero, for «این را بلدم» on a new word (PRD §5.6). */
export const E2E_IKNOW = { "learner-phone": "09120000055", "learner-desktop": "09120000057" } as const;

/**
 * Testers who know every demo word, for the reading skip exam (PRD §11.6); the learner database moves the
 * demo's last text to A2 so the exam has a level to move to.
 */
export const E2E_EXAMINERS = { "learner-phone": "09120000059", "learner-desktop": "09120000061" } as const;

/** Learners (not testers) whose three free days are over, for the lock page and a purchase (PRD §12). */
export const E2E_BUYERS = { "learner-phone": "09120000063", "learner-desktop": "09120000065" } as const;

/** Teachers on the learner server for «پلن‌ها و کدها», «سفارش‌ها» and a manual grant. */
export const E2E_SELLERS = { "learner-phone": "09120000067", "learner-desktop": "09120000069" } as const;

/** New learners from zero who report an exercise (PRD §13.10), and the teachers who answer them. */
export const E2E_REPORTERS = { "learner-phone": "09120000071", "learner-desktop": "09120000073" } as const;
export const E2E_REPORT_ADMINS = { "learner-phone": "09120000075", "learner-desktop": "09120000077" } as const;

/** The plan the learner database starts with, so a buyer has something to buy. */
export const E2E_PLAN = { name: "یک‌ماهه", days: 30, price: 290_000, badge: "پرفروش" } as const;

/**
 * Admin accounts created by prepare-db: one per browser project, and one each for the order, publish,
 * audio, settings, errors, users and review tests, since a phone may ask for only 3 codes in 10 minutes (PRD §15.5).
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
  review: "09120000017",
} as const;

/** The French frequency list of the browser-test database (prepare-db). */
export const E2E_FREQUENCY = ["être", "maison", "une", "manger", "petit", "aller"] as const;
