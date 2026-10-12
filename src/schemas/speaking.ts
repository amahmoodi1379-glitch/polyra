import { z } from "zod";
import { filled, issues, levelCode, sentenceCore, token } from "./common";

/** Situational dialogue (P-D, PRD §14.4 and §8b.4). */
const line = sentenceCore.extend({ speaker: z.string().trim().nullish().transform((value) => value || null) });
export const dialogueTurn = z.object({
  line,
  choices: z.array(sentenceCore),
  correct: z.number().int(),
  why_fa: filled,
});
export const dialogueRecord = z.object({
  code: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  level: levelCode,
  title_fa: filled,
  situation_fa: filled,
  turns: z.array(z.unknown()),
});
export const dialogueAnswer = z.object({ dialogue: z.unknown(), issues });

/** Find-the-mistake text (P-E, PRD §14.4 and §8b.5). */
export const errorfixRecord = z.object({
  level: levelCode,
  marked_text: filled,
  translation_fa: filled,
  unit_codes: z.array(filled).min(1),
  errors: z.array(z.object({ why_fa: filled })).min(1),
  tokens: z.array(token).min(1),
});
export type ErrorfixRecord = z.output<typeof errorfixRecord>;
export const errorfixAnswer = z.object({ items: z.array(z.unknown()), issues });

/** Guided writing task (P-WR, PRD §14.4 and §8b.6). */
export const writingRecord = z.object({
  level: levelCode,
  prompt_fa: filled,
  min_words: z.number().int().positive(),
  max_words: z.number().int().positive(),
  checklist_fa: z.array(filled),
  useful_phrases: z.array(z.object({ text: filled, translation_fa: filled })).nullish().transform((list) => list ?? []),
  model_answer: filled,
  model_answer_fa: filled,
});
export type WritingRecord = z.output<typeof writingRecord>;
export const writingAnswer = z.object({ tasks: z.array(z.unknown()), issues });
