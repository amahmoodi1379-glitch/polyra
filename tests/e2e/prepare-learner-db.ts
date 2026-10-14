import { normalizeMobile } from "@/lib/phone";
import { loadDemo } from "@/server/content/demo";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";
import { seedSettings } from "../../scripts/seed/settings";
import { E2E_TESTERS } from "./database";

/** Fresh learner database for the browser tests: settings, the French demo and one tester per project. */
async function main() {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  const list = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  if (list) await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

  await seedSettings(db);
  const sessionLength = await engineNumber("session.default_length");
  for (const phone of Object.values(E2E_TESTERS)) {
    await db.user.create({ data: { phone: normalizeMobile(phone)!, session_length_min: sessionLength, is_tester: true } });
  }
  const demo = await loadDemo();
  if (demo.kind !== "loaded") throw new Error(`The French demo did not load: ${demo.kind}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
