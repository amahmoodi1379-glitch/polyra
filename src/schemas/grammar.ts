import { z } from "zod";
import { filled, levelCode, optionalPersian, optionalText, persian, sentenceCore, target, targetString, token } from "./common";

/** unit_code: lowercase Latin letters, digits and hyphens, e.g. fr-a1-passe-compose-avoir-er. */
export const unitCode = z.string().trim().regex(/^[a-z]{2}-[a-c][12]-[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** One row of the unit-list answer (P-U, PRD §14.4). */
export const unitListItem = z.object({
  unit_code: unitCode,
  // A unit's title and scope may be the language's own words (der، die، das): only presence is checked.
  title_fa: filled,
  level: levelCode,
  scope_fa: filled,
  can_do_fa: optionalPersian,
});
export type UnitListItem = z.output<typeof unitListItem>;

/** A fill-in target: one or two blanks (PRD §14.2). Blank rules are checked on import. */
export const targetCore = z.object({
  marked_text: target,
  blanks: z.union([z.literal(1), z.literal(2)]),
  accepted: z.array(z.union([targetString, z.array(targetString)])).min(1),
  distractors: z.array(z.union([targetString, z.array(targetString)])).min(1),
  hint: optionalText,
  accepted_full: z.array(targetString).nullish().transform((list) => (list && list.length ? list : null)),
});

export const grammarTarget = targetCore.extend({ sentence: sentenceCore });

export const transformRecord = z.object({
  instruction_fa: persian,
  source: target,
  accepted_outputs: z.array(target).min(1),
});

export const translationRecord = z.object({
  prompt_fa: persian,
  accepted_outputs: z.array(target).min(1),
  tokens: z.array(token).min(1),
});
export type TranslationRecord = z.output<typeof translationRecord>;

const categorySet = z.object({ name: filled, items: z.array(filled).min(1) });

/** The unit itself in a P-G answer. */
export const unitRecord = z.object({
  unit_code: unitCode,
  title_fa: filled,
  level: levelCode,
  lesson_fa: persian,
  build_table: z.array(z.array(z.string())).nullish().transform((value) => value ?? null),
  example_sentences: z.array(sentenceCore).nullish().transform((list) => list ?? []),
  // A rule line or a common mistake may be written in the language alone (avoir + participe passé).
  rule_line_fa: filled,
  common_mistake_fa: filled,
  category_sets: z.array(categorySet).nullish().transform((value) => value ?? null),
  can_do_fa: optionalPersian,
});
