import { z } from "zod";

/**
 * Building blocks shared by the JSON structures of PRD §14. Keys are English and exactly as in the
 * PRD; the import step turns every problem into plain Persian (src/server/content/describe.ts).
 */

export const levelCode = z.string().regex(/^(A1|A2|B1|B2|C1|C2)$/);

export const posValues = ["noun", "verb", "adj", "adv", "prep", "pron", "det", "conj", "num", "interj", "phrase"] as const;
export const pos = z.enum(posValues);

export const frenchGenders = ["m", "f", "mf"] as const;
export const germanGenders = ["der", "die", "das"] as const;
export const gender = z.enum([...frenchGenders, ...germanGenders]);

export const grammaticalNumber = z.enum(["sg", "pl_only"]);
export const register = z.enum(["standard", "familier", "argot", "formal"]);
export const mastery = z.enum(["produce", "recognize"]);

/** Text that must not be empty once surrounding spaces are removed. */
export const filled = z.string().trim().min(1);
/** Optional text: missing, null and "" all mean "nothing". */
export const optionalText = z
  .string()
  .nullish()
  .transform((value) => (value && value.trim() ? value.trim() : null));

export const tokenKind = z.enum(["word", "name", "number", "other"]);

/** One row of `tokens` (PRD §14.1 rule 10). A missing kind means "word". */
export const token = z.object({
  surface: filled,
  kind: tokenKind.nullish().transform((value) => value ?? "word"),
  code: optionalText,
  meaning_fa: optionalText,
});
export type Token = z.output<typeof token>;

/** A target-language sentence with its translation and word mapping. */
export const sentenceCore = z.object({
  text: filled,
  tts_text: optionalText,
  translation_fa: filled,
  tokens: z.array(token).min(1),
});

/** Every importable answer has an `issues` list where the chatbot explains what it could not do. */
export const issues = z
  .array(z.unknown())
  .nullish()
  .transform((list) => (list ?? []).map((item) => (typeof item === "string" ? item : JSON.stringify(item))));
