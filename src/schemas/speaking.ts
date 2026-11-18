import { z } from "zod";
import { filled, levelCode, persian, persianMeaning, sentenceCore, target, token } from "./common";

/** Situational dialogue (P-D, PRD §14.4 and §8b.4). */
const line = sentenceCore.extend({ speaker: z.string().trim().nullish().transform((value) => value || null) });
export const dialogueTurn = z.object({
  line,
  choices: z.array(sentenceCore),
  correct: z.number().int(),
  why_fa: persian,
});
export const dialogueRecord = z.object({
  code: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  level: levelCode,
  title_fa: persian,
  situation_fa: persian,
  turns: z.array(z.unknown()),
});

/** Find-the-mistake text (P-E, PRD §14.4 and §8b.5). */
export const errorfixRecord = z.object({
  level: levelCode,
  marked_text: target,
  translation_fa: persianMeaning,
  unit_codes: z.array(filled).min(1),
  errors: z.array(z.object({ why_fa: persian })).min(1),
  tokens: z.array(token).min(1),
});
export type ErrorfixRecord = z.output<typeof errorfixRecord>;

/** Guided writing task (P-WR, PRD §14.4 and §8b.6). */
export const writingRecord = z.object({
  level: levelCode,
  prompt_fa: persian,
  min_words: z.number().int().positive(),
  max_words: z.number().int().positive(),
  checklist_fa: z.array(persian),
  useful_phrases: z.array(z.object({ text: target, translation_fa: persianMeaning })).nullish().transform((list) => list ?? []),
  model_answer: target,
  model_answer_fa: persian,
});
export type WritingRecord = z.output<typeof writingRecord>;
