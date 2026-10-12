import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Loads data/frequency/<language>.txt into `frequency_item` once per language (PRD §15.7).
 * A language that already has rows is left alone, so the "used in batch" marks are never lost.
 */
export async function seedFrequency(db: PrismaClient, languages = ["fr", "de"]) {
  const loaded: Record<string, number> = {};
  for (const language of languages) {
    const file = join(process.cwd(), "data", "frequency", `${language}.txt`);
    if (!existsSync(file)) continue;
    if ((await db.frequencyItem.count({ where: { language } })) > 0) continue;
    const lemmas = readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const rows = lemmas.map((lemma, index) => ({ language, rank: index + 1, lemma }));
    for (let start = 0; start < rows.length; start += 5000) {
      await db.frequencyItem.createMany({ data: rows.slice(start, start + 5000) });
    }
    loaded[language] = rows.length;
  }
  return loaded;
}
