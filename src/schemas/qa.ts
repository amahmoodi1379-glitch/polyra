import { z } from "zod";

/** Quality-check answer (P-QA, PRD §14.8): only the records with problems. */
export const qaFinding = z.object({
  path: z.string().trim().min(1),
  severity: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === "high" || value === "medium" ? value : "low")),
  problem: z.string().trim().min(1),
  suggestion: z.string().nullish().transform((value) => value?.trim() || null),
});
export type QaFinding = z.output<typeof qaFinding>;

export const qaAnswer = z.object({ findings: z.array(z.unknown()) });
