import { normalizeMobile } from "@/lib/phone";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";
import { seedSettings } from "../../scripts/seed/settings";
import { E2E_ADMINS, E2E_FREQUENCY } from "./database";

/**
 * Fresh database for the browser tests: every table emptied, settings seeded, two admin accounts, a
 * short French frequency list for the content path and a few German sentences with open items for
 * the resolve page.
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
  await openGermanItems();
}

/** A name that is really a listed plural, a missing word in two sentences, and a suspect form. */
async function openGermanItems() {
  const word = (code: string, pos: "noun" | "verb", meaning_fa: string, plural?: string) =>
    db.word.create({ data: { language: "de", code, lemma: code, pos, level: "A1", meaning_fa, plural, intro_order: 1 } });
  await word("Tisch", "noun", "میز", "Tische");
  const sein = await word("sein", "verb", "بودن");

  type Row = { surface: string; word_id?: number; kind?: "word" | "name"; code_given?: string; candidate_reason?: "missing" | "name_matches_word"; suspect?: boolean };
  const sentence = (text: string, translation_fa: string, rows: Row[]) =>
    db.sentence.create({
      data: {
        language: "de",
        text,
        translation_fa,
        text_hash: text,
        level: "A1",
        words: {
          create: rows.map(({ surface, ...row }, position) => {
            const start = text.indexOf(surface);
            return { position, surface, spans: [[start, start + surface.length]], kind: row.kind ?? "word", ...row };
          }),
        },
      },
    });
  await sentence("Die Tische sind neu.", "میزها نو هستند.", [{ surface: "Tische", kind: "name", candidate_reason: "name_matches_word" }]);
  await sentence("Ich esse Brot.", "من نان می‌خورم.", [{ surface: "Brot", code_given: "Brot-noun", candidate_reason: "missing" }]);
  await sentence("Das Brot ist frisch.", "نان تازه است.", [
    { surface: "Brot", code_given: "Brot-noun", candidate_reason: "missing" },
    { surface: "ist", word_id: sein.id, suspect: true },
  ]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
