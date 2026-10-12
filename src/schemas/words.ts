import { z } from "zod";
import { filled, gender, grammaticalNumber, issues, levelCode, mastery, optionalText, pos, register } from "./common";

/** One row of the word-list answer (P-C, PRD §14.4). */
export const wordListItem = z.object({
  lemma: filled,
  keep: z.boolean(),
  pos: pos.nullish(),
  level: levelCode.nullish(),
  no_card: z.boolean().nullish().transform((value) => value ?? false),
  reason: optionalText,
});
export type WordListItem = z.output<typeof wordListItem>;

const collocation = z.object({ text: filled, translation_fa: filled });

/** One word record (P-W, PRD §14.2 and §5.1). Language-dependent rules are checked on import. */
export const wordRecord = z.object({
  code: filled,
  lemma: filled,
  pos,
  gender: gender.nullish().transform((value) => value ?? null),
  number: grammaticalNumber.nullish().transform((value) => value ?? null),
  plural: optionalText,
  meaning_fa: filled,
  level: levelCode,
  register: register.nullish().transform((value) => value ?? "standard"),
  concept_fa: filled,
  no_card: z.boolean().nullish().transform((value) => value ?? false),
  homophones: z
    .array(z.string())
    .nullish()
    .transform((list) => (list ?? []).map((item) => item.trim()).filter(Boolean)),
  note_fa: optionalText,
  mastery: mastery.nullish().transform((value) => value ?? null),
  sense_of: optionalText,
  parts: z
    .array(z.string())
    .nullish()
    .transform((list) => (list ? list.map((item) => item.trim()).filter(Boolean) : null)),
  family: optionalText,
  collocations: z
    .array(collocation)
    .max(3)
    .nullish()
    .transform((list) => list ?? []),
});
export type WordRecord = z.output<typeof wordRecord>;

/** One phrase of the phrase-list answer (P-F, PRD §14.4). */
export const phraseListItem = z.object({
  lemma: filled,
  parts: z.array(filled).min(1),
  level: levelCode,
});
export type PhraseListItem = z.output<typeof phraseListItem>;

/** Top level of each answer. Records are checked one by one so a bad record never sinks the batch. */
export const wordListAnswer = z.object({ items: z.array(z.unknown()), issues });
export const wordsAnswer = z.object({ words: z.array(z.unknown()), issues });
export const phrasesAnswer = z.object({ phrases: z.array(z.unknown()), issues });
