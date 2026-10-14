import { hasCard, isColloquial, levelIndex, type Content, type WordC } from "./content";
import { lastStepOfWord } from "./pick";
import { num, type Settings } from "./settings";
import type { ItemStateE, SkillLevelE, SkillName } from "./state";

/**
 * Levels, progress bars and stations (PRD §3.2, §3.9, §6.2, §9.6). Pure counts over the learner's
 * item states and the visible content.
 */

/** Numbers fixed by the formulas of PRD §9.6 (DECISIONS.md: formula numbers are named, not settings). */
export const LEVEL_RULE = {
  /** Vocabulary goes up when 90% of the level's card words are known… */
  knownShare: 0.9,
  /** …and 70% of the introduced ones are stable. */
  stableShare: 0.7,
  /** Each progress bar is half "seen" and half "stable". */
  half: 0.5,
} as const;

export type ItemIndex = {
  words: Map<number, ItemStateE>;
  units: Map<number, ItemStateE>;
  conjugations: Map<number, ItemStateE>;
};

export function indexItems(items: readonly ItemStateE[]): ItemIndex {
  const out: ItemIndex = { words: new Map(), units: new Map(), conjugations: new Map() };
  for (const item of items) {
    const map = item.itemType === "word" ? out.words : item.itemType === "grammar_unit" ? out.units : out.conjugations;
    map.set(item.itemId, item);
  }
  return out;
}

/** A stable item (PRD §9.6): step at `stable.step` (colloquial: 2, recognize: 3) and not on probation. */
export function isStableWord(word: WordC, state: ItemStateE | undefined, settings: Settings): boolean {
  if (!state || state.probation !== "none") return false;
  const need = isColloquial(word) || word.mastery === "recognize" ? lastStepOfWord(word) : num(settings, "stable.step");
  return state.step >= need;
}

export const isStableUnit = (state: ItemStateE | undefined, settings: Settings) =>
  !!state && (state.source === "i_know" || (state.probation === "none" && state.step >= num(settings, "stable.step")));

/** A word the learner knows (PRD §5.7): has a card, is below `known_below`, or is `no_card`. */
export function knownWord(word: WordC, items: ItemIndex, vocab: SkillLevelE | undefined, content: Content): boolean {
  if (word.noCard || items.words.has(word.id)) return true;
  if (!vocab?.knownBelow) return false;
  return levelIndex(content, word.level) < levelIndex(content, vocab.knownBelow);
}

const cardWordsOf = (content: Content, level: string) => [...content.words.values()].filter((word) => hasCard(word) && word.level === level);

export type VocabProgress = { level: string; total: number; known: number; introduced: number; stable: number; progress: number; station: number; stations: number };

export function vocabProgress(content: Content, items: ItemIndex, vocab: SkillLevelE, settings: Settings): VocabProgress {
  const words = cardWordsOf(content, vocab.level);
  const known = words.filter((word) => knownWord(word, items, vocab, content)).length;
  const introduced = words.filter((word) => items.words.has(word.id)).length;
  const stable = words.filter((word) => isStableWord(word, items.words.get(word.id), settings)).length;
  const total = words.length;
  const size = num(settings, "station.words");
  return {
    level: vocab.level,
    total,
    known,
    introduced,
    stable,
    progress: total ? LEVEL_RULE.half * (known / total) + LEVEL_RULE.half * (stable / total) : 0,
    station: Math.floor(known / size),
    stations: Math.ceil(total / size),
  };
}

/** Whether vocabulary moves from its level to the next one (PRD §9.6): the next level must be open. */
export function vocabLevelUp(content: Content, items: ItemIndex, vocab: SkillLevelE, settings: Settings): string | null {
  const next = content.levels[levelIndex(content, vocab.level) + 1];
  if (!next || !content.openLevels.includes(next)) return null;
  const words = cardWordsOf(content, vocab.level);
  if (words.length === 0) return next;
  const known = words.filter((word) => knownWord(word, items, vocab, content)).length;
  const introduced = words.filter((word) => items.words.has(word.id));
  const stable = introduced.filter((word) => isStableWord(word, items.words.get(word.id), settings)).length;
  const knownOk = known / words.length >= LEVEL_RULE.knownShare;
  const stableOk = introduced.length === 0 ? false : stable / introduced.length >= LEVEL_RULE.stableShare;
  return knownOk && stableOk ? next : null;
}

export type GrammarProgress = { level: string; total: number; opened: number; stable: number; progress: number; station: number; stations: number };

/** Grammar level: the level of the newest unit the learner opened (PRD §6.2); the lowest when none. */
export function grammarLevel(content: Content, items: ItemIndex): string {
  let level = content.levels[0];
  for (const unit of content.units) if (items.units.has(unit.id) && levelIndex(content, unit.level) > levelIndex(content, level)) level = unit.level;
  return level;
}

export function grammarProgress(content: Content, items: ItemIndex, level: string, settings: Settings): GrammarProgress {
  const units = content.units.filter((unit) => unit.level === level);
  const opened = units.filter((unit) => items.units.has(unit.id)).length;
  const stable = units.filter((unit) => isStableUnit(items.units.get(unit.id), settings)).length;
  const total = units.length;
  return {
    level,
    total,
    opened,
    stable,
    progress: total ? LEVEL_RULE.half * (opened / total) + LEVEL_RULE.half * (stable / total) : 0,
    station: Math.floor(opened / num(settings, "station.units")),
    stations: Math.ceil(total / num(settings, "station.units")),
  };
}

/**
 * The overall level (PRD §3.2): the four skill levels sorted from low to high, the second one, which
 * at least three skills have reached. A skill that is not open yet counts as the lowest level.
 */
export function overallLevel(content: Pick<Content, "levels">, levels: Partial<Record<SkillName, string | null>>): string {
  const skills: SkillName[] = ["vocab", "grammar", "listening", "reading"];
  const sorted = skills.map((skill) => Math.max(0, levelIndex(content, levels[skill] ?? null))).sort((a, b) => a - b);
  return content.levels[sorted[1]];
}
