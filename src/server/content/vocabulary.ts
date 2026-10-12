import { fold, type VocabEntry, type Vocabulary } from "@/engine/tokens";
import type { Tx } from "./kinds/types";

export type VocabWord = VocabEntry & {
  code: string;
  level: string;
  no_card: boolean;
  status: string;
  meaning_fa: string | null;
};

export type LoadedVocabulary = Vocabulary & {
  words: VocabWord[];
  byId(id: number): VocabWord | undefined;
};

/**
 * Everything the word-mapping check (PRD §14.1) needs for one language: every word that is not
 * retired, its conjugation forms, the lemmas of a phrase's parts and the confirmed exceptions.
 * Codes are matched exactly first and then without case, since chatbots sometimes lower-case them.
 */
export async function loadVocabulary(tx: Tx, language: string): Promise<LoadedVocabulary> {
  const rows = await tx.word.findMany({
    where: { language, status: { not: "retired" } },
    select: {
      id: true,
      code: true,
      lemma: true,
      plural: true,
      pos: true,
      parts: true,
      level: true,
      no_card: true,
      status: true,
      meaning_fa: true,
    },
  });
  const tables = await tx.conjugationTable.findMany({
    where: { language, status: { not: "retired" } },
    select: { word_id: true, forms: true },
  });
  const exceptions = await tx.formException.findMany({
    where: { word: { language } },
    select: { word_id: true, surface: true },
  });

  const formsOf = new Map<number, string[]>();
  for (const table of tables) {
    const forms = Object.values((table.forms ?? {}) as Record<string, unknown>).filter(
      (form): form is string => typeof form === "string",
    );
    formsOf.set(table.word_id, [...(formsOf.get(table.word_id) ?? []), ...forms]);
  }

  const exact = new Map<string, VocabWord>();
  const loose = new Map<string, VocabWord | null>();
  const lemmas = new Set<string>();
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const words: VocabWord[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    lemma: row.lemma,
    plural: row.plural,
    pos: row.pos,
    level: row.level,
    no_card: row.no_card,
    status: row.status,
    meaning_fa: row.meaning_fa,
    forms: formsOf.get(row.id) ?? [],
    partLemmas: row.parts.map((code) => byCode.get(code)?.lemma ?? code),
  }));
  for (const word of words) {
    exact.set(word.code, word);
    const key = fold(word.code);
    // Two codes that differ only in case cannot be told apart loosely.
    loose.set(key, loose.has(key) ? null : word);
    lemmas.add(fold(word.lemma));
    if (word.plural) lemmas.add(fold(word.plural));
  }
  const ids = new Map(words.map((word) => [word.id, word]));
  const confirmed = new Set(exceptions.map((row) => `${row.word_id}:${fold(row.surface)}`));

  return {
    words,
    byId: (id) => ids.get(id),
    byCode: (code) => exact.get(code) ?? loose.get(fold(code)) ?? undefined,
    hasLemmaOrPlural: (text) => lemmas.has(fold(text)),
    isException: (wordId, surface) => confirmed.has(`${wordId}:${fold(surface)}`),
  };
}
