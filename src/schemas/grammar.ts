import { z } from "zod";
import { filled, issues, levelCode, optionalText, sentenceCore, token } from "./common";

/** unit_code: lowercase Latin letters, digits and hyphens, e.g. fr-a1-passe-compose-avoir-er. */
export const unitCode = z.string().trim().regex(/^[a-z]{2}-[a-c][12]-[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** One row of the unit-list answer (P-U, PRD §14.4). */
export const unitListItem = z.object({
  unit_code: unitCode,
  title_fa: filled,
  level: levelCode,
  scope_fa: filled,
  can_do_fa: optionalText,
});
export type UnitListItem = z.output<typeof unitListItem>;

/** A fill-in target: one or two blanks (PRD §14.2). Blank rules are checked on import. */
export const targetCore = z.object({
  marked_text: filled,
  blanks: z.union([z.literal(1), z.literal(2)]),
  accepted: z.array(z.union([z.string(), z.array(z.string())])).min(1),
  distractors: z.array(z.union([z.string(), z.array(z.string())])).min(1),
  hint: optionalText,
  accepted_full: z.array(z.string()).nullish().transform((list) => (list && list.length ? list : null)),
});

export const grammarTarget = targetCore.extend({ sentence: sentenceCore });

export const transformRecord = z.object({
  instruction_fa: filled,
  source: filled,
  accepted_outputs: z.array(filled).min(1),
});

export const translationRecord = z.object({
  prompt_fa: filled,
  accepted_outputs: z.array(filled).min(1),
  tokens: z.array(token).min(1),
});
export type TranslationRecord = z.output<typeof translationRecord>;

const categorySet = z.object({ name: filled, items: z.array(filled).min(1) });

/** The unit itself in a P-G answer. */
export const unitRecord = z.object({
  unit_code: unitCode,
  title_fa: filled,
  level: levelCode,
  lesson_fa: filled,
  build_table: z.array(z.array(z.string())).nullish().transform((value) => value ?? null),
  example_sentences: z.array(sentenceCore).nullish().transform((list) => list ?? []),
  rule_line_fa: filled,
  common_mistake_fa: filled,
  category_sets: z.array(categorySet).nullish().transform((value) => value ?? null),
  can_do_fa: optionalText,
});

export const unitListAnswer = z.object({ units: z.array(z.unknown()), issues });
export const grammarUnitAnswer = z.object({
  unit: z.unknown(),
  targets: z.array(z.unknown()).nullish().transform((list) => list ?? []),
  transforms: z.array(z.unknown()).nullish().transform((list) => list ?? []),
  translations: z.array(z.unknown()).nullish().transform((list) => list ?? []),
  issues,
});
export const translationsAnswer = z.object({
  unit_code: unitCode,
  translations: z.array(z.unknown()),
  issues,
});
