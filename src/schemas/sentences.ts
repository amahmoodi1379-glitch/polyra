import { z } from "zod";
import { filled, issues, sentenceCore } from "./common";
import { targetCore } from "./grammar";

/** One target of a vocabulary sentence (PRD §14.2). */
export const sentenceTarget = targetCore.extend({
  type: z.enum(["word", "grammar"]),
  target: filled,
});
export type SentenceTargetRecord = z.output<typeof sentenceTarget>;

/** One sentence of a P-S answer with its targets. */
export const sentenceRecord = sentenceCore.extend({
  targets: z.array(sentenceTarget).nullish().transform((list) => list ?? []),
});
export type SentenceRecord = z.output<typeof sentenceRecord>;

export const sentencesAnswer = z.object({ sentences: z.array(z.unknown()), issues });
