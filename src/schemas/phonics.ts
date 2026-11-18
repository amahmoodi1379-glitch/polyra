import { z } from "zod";
import { filled, persian, persianMeaning, target } from "./common";

export const phonicsLessonRecord = z.object({
  kind: z.enum(["contrast", "rule", "liaison"]),
  sound_label: filled,
  graphemes: z.array(filled).nullish().transform((list) => list ?? []),
  tip_fa: persian,
  example_words: z
    .array(z.object({ text: target, meaning_fa: persianMeaning, wrong_spellings: z.array(target) }))
    .nullish()
    .transform((list) => list ?? []),
  minimal_pairs: z
    .array(z.object({ a: target, b: target, a_fa: persianMeaning, b_fa: persianMeaning }))
    .nullish()
    .transform((list) => list ?? []),
  liaison_sentences: z
    .array(z.object({ text: target, liaison_after_word_index: z.array(z.number().int().min(0)).min(1) }))
    .nullish()
    .transform((list) => list ?? []),
});
export type PhonicsLessonRecord = z.output<typeof phonicsLessonRecord>;
