import { z } from "zod";
import { hasPersianLetter } from "@/engine/text";

/**
 * Building blocks shared by the JSON structures of PRD §14. Keys are English and exactly as in the
 * PRD; the import step turns every problem into plain Persian (src/server/content/problems.ts).
 */

export const levelCode = z.string().regex(/^(A1|A2|B1|B2|C1|C2)$/);

export const posValues = ["noun", "verb", "adj", "adv", "prep", "pron", "det", "conj", "num", "interj", "phrase"] as const;
export const pos = z.enum(posValues);

const frenchGenders = ["m", "f", "mf"] as const;
const germanGenders = ["der", "die", "das"] as const;
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

const persianLetters = (text: string) => (text.match(/(?=\p{Script=Arabic})\p{L}/gu) ?? []).length;
const latinLetters = (text: string) => (text.match(/\p{Script=Latin}/gu) ?? []).length;
/** The import and the edit forms say which rule failed (src/server/content/problems.ts, `custom` issues). */
const notPersian = { params: { problem: "notPersian" } } as const;
const persianInTarget = { params: { problem: "persianInTarget" } } as const;

/** Text with no Latin letter (a number, a sign) is never «not Persian». */
const somePersian = (value: string) => latinLetters(value) === 0 || hasPersianLetter(value);
const mostlyPersian = (value: string) => latinLetters(value) === 0 || (persianLetters(value) > 0 && persianLetters(value) * 2 >= latinLetters(value));

/**
 * Persian text, such as a lesson or an instruction: Latin letters only beside Persian ones. A field
 * written in the other language, or left in the target language by mistake, is caught on import and on edit.
 */
export const persian = filled.refine(somePersian, notPersian);
/** Optional Persian text: nothing, or text as above. */
export const optionalPersian = optionalText.refine((value) => value === null || somePersian(value), notPersian);
/**
 * A meaning or a translation: mostly Persian. A Latin gloss inside it is fine («تی‌شرت (T-shirt)»), so it
 * may have up to twice as many Latin letters as Persian ones; a meaning left in the language is not.
 */
export const persianMeaning = filled.refine(mostlyPersian, notPersian);
/** Text in the language being learned: no Persian letter (a learner could never type it, PRD §5.6). */
export const target = filled.refine((value) => !hasPersianLetter(value), persianInTarget);
/** The same, where an empty string is allowed. */
export const targetString = z.string().refine((value) => !hasPersianLetter(value), persianInTarget);

export const tokenKind = z.enum(["word", "name", "number", "other"]);

/** One row of `tokens` (PRD §14.1 rule 10). A missing kind means "word". */
export const token = z.object({
  surface: target,
  kind: tokenKind.nullish().transform((value) => value ?? "word"),
  code: optionalText,
  meaning_fa: optionalPersian,
});
export type Token = z.output<typeof token>;

/** A target-language sentence with its translation and word mapping. */
export const sentenceCore = z.object({
  text: target,
  tts_text: optionalText,
  translation_fa: persianMeaning,
  tokens: z.array(token).min(1),
});
