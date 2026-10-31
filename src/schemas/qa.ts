import { z } from "zod";

const HIGH = new Set(["high", "critical", "blocker", "major", "severe", "error", "زیاد", "بالا", "شدید", "مهم"]);
const LOW = new Set(["low", "minor", "trivial", "info", "nit", "cosmetic", "کم", "پایین", "جزئی"]);

/**
 * Quality-check answer (P-QA, PRD §14.8): only the records with problems. The prompt asks for
 * high, medium or low; other words a chatbot uses for them are read the same way, and a severity
 * that is missing or unknown counts as medium, so a finding is never quietly made less serious.
 */
export const qaFinding = z.object({
  path: z.string().trim().catch(""),
  severity: z
    .unknown()
    .transform((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .transform((value) => (HIGH.has(value) ? "high" : LOW.has(value) ? "low" : "medium") as "high" | "medium" | "low"),
  problem: z.string().trim().min(1),
  suggestion: z.string().nullish().transform((value) => value?.trim() || null),
});
export type QaFinding = z.output<typeof qaFinding>;

export const qaAnswer = z.object({ findings: z.array(z.unknown()) });
