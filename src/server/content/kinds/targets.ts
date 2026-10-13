import { db } from "@/server/db";
import type { LevelTargets } from "@/server/settings/app-catalog";
import { appSetting } from "@/server/settings/read";
import { levelRank } from "../languages";

/** What the next batch of a kind counted against the level targets is, or what it waits for. */
export type LevelNext =
  | { state: "ready"; level: string; left: number; goal: number; size: number }
  | { state: "needsUnits"; level: string }
  | { state: "needsWords"; level: string; count: number }
  | { state: "done" };

export const openStates = ["prompt_made", "pasted"] as const;

/** Card words that have their meaning: up to a level (for "the first N words") and at the level. */
export async function readyWords(language: string, level: string) {
  const words = await db.word.findMany({
    where: { language, meaning_fa: { not: null }, no_card: false, register: "standard", dup_of_id: null, status: { not: "retired" } },
    select: { level: true },
  });
  return { upTo: words.filter((word) => levelRank(word.level) <= levelRank(level)).length, at: words.filter((word) => word.level === level).length };
}

/**
 * The lowest level (or the one asked for) whose count is below its target in the general settings
 * (PRD §7.8, §8b.7), and whether it can be made yet: its grammar units must exist (the prompt lists
 * them as the allowed structures) and its words must have their meaning. `firstWords` is for a level
 * whose prompt uses the first words of the teaching order instead of the whole level.
 */
export async function nextLevel(
  language: string,
  field: keyof LevelTargets,
  counts: Map<string, number>,
  options: { wanted?: string; size: number; firstWords?: (level: string) => number | null },
): Promise<LevelNext> {
  const [levels, targets] = await Promise.all([
    appSetting<string[]>(`levels.${language}`),
    appSetting<Record<string, LevelTargets>>(`targets.${language}`),
  ]);
  const short = levels.filter((level) => (counts.get(level) ?? 0) < (targets[level]?.[field] ?? 0));
  const level = options.wanted && short.includes(options.wanted) ? options.wanted : short[0];
  if (!level) return { state: "done" };

  const units = await db.grammarUnit.count({ where: { language, level, status: { not: "retired" } } });
  if (units === 0) return { state: "needsUnits", level };
  const first = options.firstWords?.(level) ?? null;
  const words = await readyWords(language, level);
  if ((first ? words.upTo : words.at) < (first ?? 1)) return { state: "needsWords", level, count: first ?? 1 };

  const goal = targets[level][field];
  const left = goal - (counts.get(level) ?? 0);
  return { state: "ready", level, left, goal, size: Math.min(options.size, left) };
}

/** Grammar units of a level and below, one "unit_code | title | level" line each, in teaching order. */
export async function unitLines(language: string, level: string) {
  const units = await db.grammarUnit.findMany({
    where: { language, status: { not: "retired" } },
    select: { unit_code: true, title_fa: true, level: true, order_no: true },
  });
  return units
    .filter((unit) => levelRank(unit.level) <= levelRank(level))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.order_no ?? 1e9) - (b.order_no ?? 1e9))
    .map((unit) => [unit.unit_code, unit.title_fa, unit.level].join(" | "));
}

export const wordCount = (text: string) => text.split(/\s+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;
