import { z } from "zod";
import { filled, issues } from "./common";

export const phonicsLessonRecord = z.object({
  kind: z.enum(["contrast", "rule", "liaison"]),
  sound_label: filled,
  graphemes: z.array(filled).nullish().transform((list) => list ?? []),
  tip_fa: filled,
  example_words: z
    .array(z.object({ text: filled, meaning_fa: filled, wrong_spellings: z.array(filled) }))
    .nullish()
    .transform((list) => list ?? []),
  minimal_pairs: z
    .array(z.object({ a: filled, b: filled, a_fa: filled, b_fa: filled }))
    .nullish()
    .transform((list) => list ?? []),
  liaison_sentences: z
    .array(z.object({ text: filled, liaison_after_word_index: z.array(z.number().int().min(0)).min(1) }))
    .nullish()
    .transform((list) => list ?? []),
});
export type PhonicsLessonRecord = z.output<typeof phonicsLessonRecord>;

export const phonicsAnswer = z.object({ lesson: z.unknown(), issues });
