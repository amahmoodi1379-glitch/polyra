import { newItemState } from "@/engine/answer";
import { normalizeMobile } from "@/lib/phone";
import { loadDemo } from "@/server/content/demo";
import { db } from "@/server/db";
import { startFromZero } from "@/server/learn/enroll";
import { saveItemState } from "@/server/learn/writes";
import { engineNumber } from "@/server/settings/read";
import { seedSettings } from "../../scripts/seed/settings";
import { E2E_READERS, E2E_TESTERS } from "./database";

/**
 * Fresh learner database for the browser tests: settings, the French demo, one new tester per project,
 * and one per project who has met every demo word, for the texts.
 */
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

  const words = await db.word.findMany({ where: { language: "fr", no_card: false }, select: { id: true } });
  const now = new Date();
  for (const phone of Object.values(E2E_READERS)) {
    const user = await db.user.create({ data: { phone: normalizeMobile(phone)!, session_length_min: sessionLength, is_tester: true } });
    await startFromZero(user, "fr", now);
    await db.$transaction(async (tx) => {
      for (const word of words) await saveItemState(tx, { userId: user.id, language: "fr" }, newItemState("word", word.id, now));
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
