import "dotenv/config";
import { normalizeMobile } from "@/lib/phone";
import { db } from "@/server/db";
import { seedSettings } from "./settings";

/**
 * `npm run seed`: settings, languages, one admin and one tester account (PRD §15.7).
 * Synthetic content (fixtures/synthetic) joins this script when the engine phase starts.
 * Phones come from SEED_ADMIN_PHONE and SEED_TESTER_PHONE, with made-up defaults for development.
 */
async function main() {
  const settings = await seedSettings(db);
  console.log(`Settings: ${settings.engineSettings} engine, ${settings.appSettings} general.`);

  const lengthSetting = await db.engineSetting.findUniqueOrThrow({ where: { key: "session.default_length" } });
  const defaultLength = Number(lengthSetting.value);
  const accounts = [
    { phone: process.env.SEED_ADMIN_PHONE ?? "09120000001", is_admin: true, is_tester: false, admin_language: "fr" },
    { phone: process.env.SEED_TESTER_PHONE ?? "09120000002", is_admin: false, is_tester: true, admin_language: null },
  ];
  for (const account of accounts) {
    const phone = normalizeMobile(account.phone);
    if (!phone) throw new Error(`Not a valid mobile number: ${account.phone}`);
    await db.user.upsert({
      where: { phone },
      update: { is_admin: account.is_admin, is_tester: account.is_tester },
      create: {
        phone,
        session_length_min: defaultLength,
        is_admin: account.is_admin,
        is_tester: account.is_tester,
        admin_language: account.admin_language,
      },
    });
    console.log(`${account.is_admin ? "Admin" : "Tester"}: ${phone}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
