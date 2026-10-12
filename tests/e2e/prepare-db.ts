import { normalizeMobile } from "@/lib/phone";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";
import { seedSettings } from "../../scripts/seed/settings";
import { E2E_ADMINS, E2E_FREQUENCY } from "./database";

/**
 * Fresh database for the browser tests: every table emptied, settings seeded, two admin accounts and
 * a short French frequency list for the content path.
 */
async function main() {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  const list = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  if (list) await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

  await seedSettings(db);
  const sessionLength = await engineNumber("session.default_length");
  for (const phone of Object.values(E2E_ADMINS)) {
    await db.user.create({
      data: { phone: normalizeMobile(phone)!, session_length_min: sessionLength, is_admin: true, admin_language: "fr" },
    });
  }
  await db.frequencyItem.createMany({ data: E2E_FREQUENCY.map((lemma, index) => ({ language: "fr", rank: index + 1, lemma })) });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
