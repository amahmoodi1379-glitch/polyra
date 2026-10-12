import "dotenv/config";
import { normalizeMobile } from "@/lib/phone";
import { db } from "@/server/db";
import { seedSettings } from "./settings";

/**
 * `npm run seed`: settings, languages, one admin and one tester account (PRD §15.7).
 * Synthetic content (fixtures/synthetic) joins this script when the engine phase starts.
 * Phones come from SEED_ADMIN_PHONE and SEED_TESTER_PHONE. In development they have made-up
 * defaults; on a server (NODE_ENV=production) an account is made only when its variable is set.
 * Safe to run on every start: settings keep the admin's values and accounts are upserted.
 */
async function main() {
  const settings = await seedSettings(db);
  console.log(`Settings: ${settings.engineSettings} engine, ${settings.appSettings} general.`);

  const lengthSetting = await db.engineSetting.findUniqueOrThrow({ where: { key: "session.default_length" } });
  const defaultLength = Number(lengthSetting.value);
  const onServer = process.env.NODE_ENV === "production";
  const accounts = [
    { phone: process.env.SEED_ADMIN_PHONE ?? (onServer ? null : "09120000001"), is_admin: true, is_tester: false, admin_language: "fr" },
    { phone: process.env.SEED_TESTER_PHONE ?? (onServer ? null : "09120000002"), is_admin: false, is_tester: true, admin_language: null },
  ];
  for (const account of accounts) {
    if (!account.phone) continue;
    const phone = normalizeMobile(account.phone);
    if (!phone) throw new Error(`Not a valid mobile number: ${account.phone}`);
    await db.user.upsert({
      where: { phone },
      // Only ever grants; never takes away a role someone gave in the panel.
      update: account.is_admin ? { is_admin: true } : { is_tester: true },
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
