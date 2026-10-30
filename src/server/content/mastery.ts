import type { Mastery } from "@/generated/prisma/client";
import type { Tx } from "./kinds/types";

/**
 * «نوشتنی» or «شناختنی» (PRD §5.1, §13.4): every A1 and A2 word and every phrase is written; from B1
 * a word whose frequency rank is within `mastery.produce_rank` is written and a rarer one recognized.
 * A word without a rank keeps what the chatbot suggested. A teacher's own choice is never touched.
 */

/** Levels whose words are always written (PRD §5.1). */
export const PRODUCE_LEVELS = new Set(["A1", "A2"]);

export function defaultMastery(word: { level: string; pos: string }, rank: number | null, produceRank: number, otherwise: Mastery | null): Mastery {
  if (PRODUCE_LEVELS.has(word.level) || word.pos === "phrase") return "produce";
  if (rank !== null) return rank <= produceRank ? "produce" : "recognize";
  return otherwise ?? "produce";
}

/** A new `mastery.produce_rank`: the ranked words of B1 and above that no teacher set by hand follow it (T110). */
export async function applyProduceRank(tx: Tx, produceRank: number) {
  const where = { mastery_manual: false, frequency_rank: { not: null }, pos: { not: "phrase" as const }, level: { notIn: [...PRODUCE_LEVELS] } };
  await tx.word.updateMany({ where: { ...where, frequency_rank: { lte: produceRank }, mastery: "recognize" }, data: { mastery: "produce" } });
  await tx.word.updateMany({ where: { ...where, frequency_rank: { gt: produceRank }, mastery: "produce" }, data: { mastery: "recognize" } });
}
