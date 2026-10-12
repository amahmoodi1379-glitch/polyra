import { z } from "zod";
import { filled, issues, levelCode, optionalText, sentenceCore } from "./common";

/**
 * One question of a text (PRD §14.3). Indexes start at 0. Cross-field rules are checked on import.
 * `prompt_fa` is the Persian translation of a band 3 or 4 question, which the learner can open (§7.3).
 */
const explanation = { explanation_fa: optionalText, prompt_fa: optionalText };
export const question = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mcq"), prompt: filled, options: z.array(filled).min(2), correct: z.number().int(), ...explanation }),
  z.object({ type: z.literal("tf"), prompt: filled, correct: z.boolean(), ...explanation }),
  z.object({ type: z.literal("order"), prompt: filled, items: z.array(filled).min(2), correct_order: z.array(z.number().int()), ...explanation }),
  z.object({
    type: z.literal("match"),
    prompt: filled,
    left: z.array(filled).min(2),
    right: z.array(filled).min(2),
    pairs: z.array(z.tuple([z.number().int(), z.number().int()])).min(1),
    ...explanation,
  }),
  z.object({
    type: z.literal("cloze"),
    prompt: filled,
    text_with_gaps: filled,
    bank: z.array(filled).min(1),
    answers: z.array(filled).min(1),
    ...explanation,
  }),
  z.object({ type: z.literal("find"), prompt: filled, correct_sentence: z.number().int(), ...explanation }),
  z.object({ type: z.literal("ctx"), word: filled, prompt: filled, options: z.array(filled).min(2), correct: z.number().int(), ...explanation }),
  z.object({ type: z.literal("num"), prompt: filled, answer: filled, accepted: z.array(filled).min(1), ...explanation }),
  z.object({ type: z.literal("dict"), sentence: z.number().int(), ...explanation }),
]);
export type QuestionRecord = z.output<typeof question>;

const questionSet = z.object({ A: z.array(z.unknown()), B: z.array(z.unknown()) });

export const textSentence = sentenceCore.extend({ speaker: optionalText });

export const textRecord = z.object({
  code: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: filled,
  kind: filled,
  level: levelCode,
  band: z.number().int().min(1).max(4),
  placement_ok: z.boolean().nullish().transform((value) => value ?? false),
  sentences: z.array(z.unknown()).min(1),
  key_words: z.array(filled).max(5).nullish().transform((list) => list ?? []),
  question_sets: z.object({ reading: questionSet, listening: questionSet }),
});

export type TextRecord = z.output<typeof textRecord>;
export type TextSentence = z.output<typeof textSentence>;

export const textsAnswer = z.object({ texts: z.array(z.unknown()), issues });
