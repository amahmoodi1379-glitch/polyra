import { levelRank } from "../languages";

/** What the count needs of a word: where it sits in the order and whether it ever becomes a card. */
export type OrderedWord = {
  id: number;
  level: string;
  intro_order: number | null;
  no_card: boolean;
  retired: boolean;
  /** The word this one is a duplicate of; the sentence then counts as using that word. */
  dup_of_id: number | null;
};

/** One sentence: the card words it is a live target for, and its word tokens (null = an unresolved candidate). */
export type SentenceTokens = { targets: number[]; tokens: { wordId: number | null; surface: string }[] };

/** Why a sentence is not usable for a word: a word met later, a candidate still unresolved, or a retired word. */
export type Blocker = { key: string; wordId: number | null; surface: string; reason: "later" | "unknown" | "retired"; count: number };

export type UsableCount = { total: number; usable: number; blockers: Blocker[] };

/**
 * «جمله قابل‌استفاده هر کلمه» (PRD §13.11): for each target word, how many of its sentences use only
 * words a learner already has when this word arrives: no_card words, words of a lower level, or words
 * earlier in the current order of the same level. Each other word is a blocker, counted once per sentence.
 * The first words of a language are made into sentences with each other (PRD §14.9), so among
 * `firstWords` every word counts as known.
 */
export function usableSentences(words: Map<number, OrderedWord>, sentences: SentenceTokens[], firstWords: Set<number> = new Set()): Map<number, UsableCount> {
  const result = new Map<number, UsableCount>();
  const blockersOf = new Map<number, Map<string, Blocker>>();

  for (const sentence of sentences) {
    for (const targetId of new Set(sentence.targets)) {
      const target = words.get(targetId);
      if (!target) continue;
      const count = result.get(targetId) ?? { total: 0, usable: 0, blockers: [] };
      result.set(targetId, count);
      count.total++;

      const found = new Map<string, Omit<Blocker, "count">>();
      for (const token of sentence.tokens) {
        const blocker = blockerFor(words, target, token, firstWords);
        if (blocker && !found.has(blocker.key)) found.set(blocker.key, blocker);
      }
      if (found.size === 0) {
        count.usable++;
        continue;
      }
      const tally = blockersOf.get(targetId) ?? new Map<string, Blocker>();
      blockersOf.set(targetId, tally);
      for (const blocker of found.values()) {
        const seen = tally.get(blocker.key);
        if (seen) seen.count++;
        else tally.set(blocker.key, { ...blocker, count: 1 });
      }
    }
  }

  for (const [id, tally] of blockersOf) {
    result.get(id)!.blockers = [...tally.values()].sort((a, b) => b.count - a.count || a.surface.localeCompare(b.surface));
  }
  return result;
}

function blockerFor(words: Map<number, OrderedWord>, target: OrderedWord, token: SentenceTokens["tokens"][number], firstWords: Set<number>): Omit<Blocker, "count"> | null {
  if (token.wordId === null) return { key: `?${token.surface.toLowerCase()}`, wordId: null, surface: token.surface, reason: "unknown" };
  let word = words.get(token.wordId);
  if (word?.dup_of_id) word = words.get(word.dup_of_id) ?? word;
  if (!word) return { key: `?${token.surface.toLowerCase()}`, wordId: null, surface: token.surface, reason: "unknown" };
  if (word.id === target.id) return null;
  if (word.retired) return { key: `#${word.id}`, wordId: word.id, surface: token.surface, reason: "retired" };
  if (firstWords.has(word.id) && firstWords.has(target.id)) return null;
  return knownBefore(word, target) ? null : { key: `#${word.id}`, wordId: word.id, surface: token.surface, reason: "later" };
}

/** True when a learner meets `word` before `target`: it is never a card, its level is lower, or it is earlier in the order. */
export function knownBefore(word: OrderedWord, target: OrderedWord) {
  if (word.no_card) return true;
  const rank = levelRank(word.level) - levelRank(target.level);
  if (rank !== 0) return rank < 0;
  return (word.intro_order ?? Infinity) < (target.intro_order ?? Infinity);
}
