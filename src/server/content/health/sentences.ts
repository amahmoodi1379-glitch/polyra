import { db } from "@/server/db";
import { appSetting, engineNumber } from "@/server/settings/read";
import { levelRank, type LanguageCode } from "../languages";
import { cardWord, firstWordIds } from "../kinds/sentences";
import { usableSentences, type Blocker, type OrderedWord, type SentenceTokens } from "./usable";

/** At most this many blockers are named on a row; the rest are counted. */
const BLOCKERS_SHOWN = 4;

export type HealthBlocker = Blocker & { label: string };
export type HealthRow = {
  id: number;
  code: string;
  lemma: string;
  level: string;
  introOrder: number | null;
  total: number;
  usable: number;
  blockers: HealthBlocker[];
  moreBlockers: number;
};
export type LevelHealth = { level: string; cardWords: number; healthy: number; low: HealthRow[]; none: HealthRow[] };

/**
 * The «جمله قابل‌استفاده هر کلمه» part of «سلامت محتوا» (PRD §13.11), counted fresh on every visit so
 * it follows each import and each change of order. A word is flagged below `health.min_usable_sentences`;
 * words without any sentence yet are listed apart, since step 1 of P-S already picks them.
 */
export async function sentenceHealth(language: LanguageCode): Promise<{ min: number; levels: LevelHealth[] }> {
  const [min, levels] = await Promise.all([engineNumber("health.min_usable_sentences"), appSetting<string[]>(`levels.${language}`)]);
  const [allWords, cards, targets] = await Promise.all([
    db.word.findMany({
      where: { language },
      orderBy: [{ intro_order: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      select: { id: true, lemma: true, level: true, intro_order: true, no_card: true, register: true, status: true, dup_of_id: true },
    }),
    db.word.findMany({ where: { language, ...cardWord }, select: { id: true, code: true, lemma: true, level: true, intro_order: true } }),
    db.sentenceTarget.findMany({
      where: { language, target_type: "word", status: { not: "retired" }, suspended: false, sentence: { status: { not: "retired" }, suspended: false } },
      select: { sentence_id: true, target_id: true },
    }),
  ]);

  const words = new Map<number, OrderedWord>(allWords.map((word) => [word.id, { ...word, retired: word.status === "retired" }]));
  const lemmaOf = new Map(allWords.map((word) => [word.id, word.lemma]));
  const sentenceIds = [...new Set(targets.map((target) => target.sentence_id))];
  const tokens = sentenceIds.length
    ? await db.sentenceWord.findMany({ where: { sentence_id: { in: sentenceIds }, kind: "word" }, select: { sentence_id: true, word_id: true, surface: true } })
    : [];

  const sentences = new Map<number, SentenceTokens>(sentenceIds.map((id) => [id, { targets: [], tokens: [] }]));
  for (const target of targets) sentences.get(target.sentence_id)!.targets.push(target.target_id);
  for (const token of tokens) sentences.get(token.sentence_id)!.tokens.push({ wordId: token.word_id, surface: token.surface });
  const firstWords = firstWordIds(allWords.filter((word) => word.status !== "retired" && word.dup_of_id === null));
  const counts = usableSentences(words, [...sentences.values()], firstWords);

  const byLevel = new Map<string, LevelHealth>(levels.map((level) => [level, { level, cardWords: 0, healthy: 0, low: [], none: [] }]));
  const ordered = [...cards].sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9) || a.id - b.id);
  for (const word of ordered) {
    const group = byLevel.get(word.level);
    if (!group) continue;
    group.cardWords++;
    const count = counts.get(word.id) ?? { total: 0, usable: 0, blockers: [] };
    if (count.usable >= min) {
      group.healthy++;
      continue;
    }
    const row: HealthRow = {
      id: word.id,
      code: word.code,
      lemma: word.lemma,
      level: word.level,
      introOrder: word.intro_order,
      total: count.total,
      usable: count.usable,
      blockers: count.blockers
        .slice(0, BLOCKERS_SHOWN)
        .map((blocker) => ({ ...blocker, label: blocker.wordId === null ? blocker.surface : (lemmaOf.get(blocker.wordId) ?? blocker.surface) })),
      moreBlockers: Math.max(0, count.blockers.length - BLOCKERS_SHOWN),
    };
    (count.total === 0 ? group.none : group.low).push(row);
  }
  return { min, levels: [...byLevel.values()] };
}
