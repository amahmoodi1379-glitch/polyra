import type { PromptKind } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { appSetting, engineNumber } from "@/server/settings/read";
import { hasQa } from "./batches";
import { nextUnit } from "./kinds/grammar";
import { levelRank } from "./languages";
import { openCounts } from "./resolve";

export type LevelCount = { level: string; count: number };

export type ContentStatus = {
  frequencyLeft: number;
  wordCount: number;
  /** Draft words from the word list that still have no meaning, lowest level first (PRD §13.9). */
  wordsWithoutInfo: LevelCount[];
  /** Card words with fewer targets than the goal, lowest level first. */
  wordsWithoutSentences: LevelCount[];
  sentenceGoal: number;
  /** Levels that have no grammar units yet. */
  levelsWithoutUnits: string[];
  hasUnits: boolean;
  /** The next grammar unit without a lesson, and how many of its level are waiting (P-G). */
  grammarNext: { title: string; level: string; count: number } | null;
  waitingQa: number;
  unfinished: number;
  /** Open items on the resolve page, as groups (one word in many sentences counts once). */
  candidates: number;
  suspects: number;
  duplicates: number;
};

const byLevel = (rows: LevelCount[]) => rows.filter((row) => row.count > 0).sort((a, b) => levelRank(a.level) - levelRank(b.level));

/** What is left to make in one language: the numbers behind the workbench and the create page. */
export async function contentStatus(language: string): Promise<ContentStatus> {
  const levels = await appSetting<string[]>(`levels.${language}`);
  const goal = await engineNumber("publish.word_goal_targets");

  const [frequencyLeft, wordCount, skeletons, cardWords, targetCounts, unitLevels, batches, open, grammar] =
    await Promise.all([
      db.frequencyItem.count({ where: { language, used_in_batch_id: null } }),
      db.word.count({ where: { language, status: { not: "retired" } } }),
      db.word.groupBy({ by: ["level"], where: { language, meaning_fa: null, status: "draft", dup_of_id: null }, _count: true }),
      db.word.findMany({
        where: { language, meaning_fa: { not: null }, no_card: false, register: "standard", dup_of_id: null, status: { not: "retired" } },
        select: { id: true, level: true },
      }),
      db.sentenceTarget.groupBy({
        by: ["target_id"],
        where: { language, target_type: "word", status: { not: "retired" } },
        _count: true,
      }),
      db.grammarUnit.groupBy({ by: ["level"], where: { language } }),
      db.importBatch.findMany({ where: { language }, select: { state: true, prompt_kind: true } }),
      openCounts(language),
      nextUnit(language),
    ]);

  const counts = new Map(targetCounts.map((row) => [row.target_id, row._count]));
  const short = new Map<string, number>();
  for (const word of cardWords) {
    if ((counts.get(word.id) ?? 0) < goal) short.set(word.level, (short.get(word.level) ?? 0) + 1);
  }
  const withUnits = new Set(unitLevels.map((row) => row.level));
  const isOpen = (state: string) => state === "prompt_made" || state === "pasted";

  return {
    frequencyLeft,
    wordCount,
    wordsWithoutInfo: byLevel(skeletons.map((row) => ({ level: row.level, count: row._count }))),
    wordsWithoutSentences: byLevel([...short].map(([level, count]) => ({ level, count }))),
    sentenceGoal: goal,
    levelsWithoutUnits: levels.filter((level) => !withUnits.has(level)),
    hasUnits: unitLevels.length > 0,
    grammarNext: grammar ? { title: grammar.unit.title_fa, level: grammar.unit.level, count: grammar.waiting } : null,
    waitingQa: batches.filter((batch) => batch.state === "imported" && hasQa(batch.prompt_kind as PromptKind)).length,
    unfinished: batches.filter((batch) => isOpen(batch.state)).length,
    ...open,
  };
}
