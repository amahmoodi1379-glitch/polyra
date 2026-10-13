import { appSetting } from "@/server/settings/read";
import type { Tx } from "./kinds/types";

type Range = [number, number];

/** The two halves of PRD §7.5's formula weigh the same. */
const LENGTH_WEIGHT = 0.5;
const clip = (value: number) => Math.min(1, Math.max(0, value));

/**
 * `difficulty_score` (PRD §7.5): half the text's length within its band (§7.1), half the share of
 * its distinct words that are of the text's own level. Each half is clipped to 0..1.
 */
export function difficultyScore(wordCount: number, band: Range, sameLevelShare: number) {
  const [min, max] = band;
  const length = max > min ? clip((wordCount - min) / (max - min)) : 0;
  return LENGTH_WEIGHT * length + (1 - LENGTH_WEIGHT) * clip(sameLevelShare);
}

/** Texts made of any of these sentences or using any of these words. */
async function textsTouching(tx: Tx, scope: { textIds?: number[]; sentenceIds?: number[]; wordIds?: number[] }) {
  const ids = new Set(scope.textIds ?? []);
  const sentenceIds = new Set(scope.sentenceIds ?? []);
  if (scope.wordIds?.length) {
    const rows = await tx.sentenceWord.findMany({
      where: { word_id: { in: scope.wordIds } },
      select: { sentence_id: true },
      distinct: ["sentence_id"],
    });
    for (const row of rows) sentenceIds.add(row.sentence_id);
  }
  if (sentenceIds.size > 0) {
    const texts = await tx.text.findMany({
      where: { sentence_ids: { hasSome: [...sentenceIds] } },
      select: { id: true },
    });
    for (const text of texts) ids.add(text.id);
  }
  return [...ids];
}

/**
 * Computes `difficulty_score` again for the texts a change touches: a text that came in, a sentence
 * whose words changed, a word that moved to another level.
 */
export async function refreshDifficulty(tx: Tx, scope: { textIds?: number[]; sentenceIds?: number[]; wordIds?: number[] }) {
  const ids = await textsTouching(tx, scope);
  if (ids.length === 0) return;
  const [texts, bands] = await Promise.all([
    tx.text.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        level: true,
        band: true,
        word_count: true,
        sentence_ids: true,
        difficulty_score: true,
      },
    }),
    appSetting<Record<string, Range>>("prompt.text_bands"),
  ]);
  const rows = await tx.sentenceWord.findMany({
    where: {
      sentence_id: { in: texts.flatMap((text) => text.sentence_ids) },
      word_id: { not: null },
    },
    select: { sentence_id: true, word: { select: { id: true, level: true } } },
  });
  for (const text of texts) {
    const inText = new Set(text.sentence_ids);
    const words = new Map(rows.filter((row) => inText.has(row.sentence_id) && row.word).map((row) => [row.word!.id, row.word!.level]));
    const share = words.size > 0 ? [...words.values()].filter((level) => level === text.level).length / words.size : 0;
    const score = Math.round(difficultyScore(text.word_count ?? 0, bands[String(text.band)] ?? [0, 0], share) * 1000) / 1000;
    if (score !== text.difficulty_score)
      await tx.text.update({
        where: { id: text.id },
        data: { difficulty_score: score },
      });
  }
}

/**
 * Where a new text of a level goes. A level the teacher has arranged by hand keeps that order and a
 * new text joins at its end; otherwise texts follow `difficulty_score` and need no number (DECISIONS).
 */
export async function overrideForNewText(tx: Tx, language: string, level: string) {
  const last = await tx.text.aggregate({
    where: { language, level, order_override: { not: null } },
    _max: { order_override: true },
  });
  return last._max.order_override === null ? null : last._max.order_override + 1;
}
