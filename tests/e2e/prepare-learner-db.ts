import { newItemState } from "@/engine/answer";
import { normalizeMobile } from "@/lib/phone";
import { loadDemo } from "@/server/content/demo";
import { db } from "@/server/db";
import { startFromZero } from "@/server/learn/enroll";
import { saveItemState } from "@/server/learn/writes";
import { engineNumber } from "@/server/settings/read";
import { seedSettings } from "../../scripts/seed/settings";
import { E2E_EXAMINERS, E2E_IKNOW, E2E_PHONICS, E2E_PLACERS, E2E_READERS, E2E_TESTERS, E2E_TRY_ADMINS, E2E_WRITERS } from "./database";

/**
 * Fresh learner database for the browser tests: settings, the French demo, one new tester per project,
 * one per project who has met every demo word, for the texts, one per project from zero, for phonics,
 * one per project at vocabulary B1, for the weekly writing, and one per project who has not started, for placement, and a teacher per project for «آزمایش مثل زبان‌آموز».
 * For the level tools: one per project from zero, for «این را بلدم», and one per project who knows every word,
 * for the reading skip exam; the demo's last text moves to A2 so that exam has somewhere to go.
 */
async function main() {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  const list = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  if (list) await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

  await seedSettings(db);
  const sessionLength = await engineNumber("session.default_length");
  for (const phone of [...Object.values(E2E_TESTERS), ...Object.values(E2E_PLACERS)]) {
    await db.user.create({ data: { phone: normalizeMobile(phone)!, session_length_min: sessionLength, is_tester: true } });
  }
  for (const phone of Object.values(E2E_TRY_ADMINS)) {
    await db.user.create({ data: { phone: normalizeMobile(phone)!, session_length_min: sessionLength, is_admin: true, admin_language: "fr" } });
  }
  const demo = await loadDemo();
  if (demo.kind !== "loaded") throw new Error(`The French demo did not load: ${demo.kind}`);

  for (const phone of [...Object.values(E2E_PHONICS), ...Object.values(E2E_IKNOW)]) {
    const user = await db.user.create({ data: { phone: normalizeMobile(phone)!, session_length_min: sessionLength, is_tester: true } });
    await startFromZero(user, "fr", new Date());
  }

  const words = await db.word.findMany({ where: { language: "fr", no_card: false }, select: { id: true } });
  const now = new Date();
  for (const phone of [...Object.values(E2E_READERS), ...Object.values(E2E_EXAMINERS)]) {
    const user = await db.user.create({ data: { phone: normalizeMobile(phone)!, session_length_min: sessionLength, is_tester: true } });
    await startFromZero(user, "fr", now);
    await db.$transaction(async (tx) => {
      for (const word of words) await saveItemState(tx, { userId: user.id, language: "fr" }, newItemState("word", word.id, now));
    });
  }

  const last = await db.text.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "desc" }, select: { id: true } });
  await db.text.update({ where: { id: last.id }, data: { level: "A2" } });

  for (const phone of Object.values(E2E_WRITERS)) {
    const user = await db.user.create({ data: { phone: normalizeMobile(phone)!, session_length_min: sessionLength, is_tester: true } });
    await startFromZero(user, "fr", now);
    await db.skillLevel.updateMany({ where: { user_id: user.id, language: "fr", skill: "vocab" }, data: { level: "B1" } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
