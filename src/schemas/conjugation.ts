import { z } from "zod";
import { filled, issues } from "./common";

/** Pronoun keys of the six forms (PRD §14.4). */
export const pronounKeys = {
  fr: ["je", "tu", "il_elle_on", "nous", "vous", "ils_elles"],
  de: ["ich", "du", "er_sie_es", "wir", "ihr", "sie_Sie"],
} as const;

export const conjugationRecord = z.object({
  verb: filled,
  tense: filled,
  unit_code: z.string().trim().nullish().transform((value) => value || null),
  forms: z.record(z.string(), z.string()),
  accepted_variants: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .nullish()
    .transform((value) => value ?? {}),
  review_card: z.boolean().nullish().transform((value) => value ?? false),
});
export type ConjugationRecord = z.output<typeof conjugationRecord>;

export const conjugationAnswer = z.object({ tables: z.array(z.unknown()), issues });
