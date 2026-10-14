import { hasCard, isColloquial, levelIndex, type ConjC, type Content, type UnitC, type WordC } from "../content";
import { num, type Settings } from "../settings";
import type { ItemStateE, LearnerSnapshot, QueueE } from "../state";

/**
 * Which new material comes next (PRD §5.8, §6.2, §6.6, §10.3): the order of new words, the next unit
 * and the conjugation cards that may be made.
 */

const QUEUE_ORDER: Record<QueueE["source"], number> = { tap: 0, key_word: 1, colloquial: 2 };

export type NewWordContext = {
  content: Content;
  learner: LearnerSnapshot;
  settings: Settings;
  now: Date;
  /** Words with a card, or already chosen for this session. */
  taken: (wordId: number) => boolean;
  /** "Known" (PRD §5.7). */
  known: (wordId: number) => boolean;
  /** Queue words already chosen in this session, on top of today's count. */
  queueUsed?: number;
};

/** A new sense needs its base word known, a phrase all its parts (PRD §5.8). */
function ready(word: WordC, ctx: NewWordContext): boolean {
  if (word.senseOf) {
    const base = ctx.content.wordByCode.get(word.senseOf);
    if (!base || !ctx.known(base.id)) return false;
  }
  if (word.pos === "phrase") {
    for (const code of word.parts) {
      const part = ctx.content.wordByCode.get(code);
      if (!part || !ctx.known(part.id)) return false;
    }
  }
  return true;
}

/** Queue rows that may still be introduced today, in order (PRD §5.8, row 1). */
export function queueWords(ctx: NewWordContext): WordC[] {
  const expire = num(ctx.settings, "queue.expire_days") * 86_400_000;
  const room = Math.max(0, num(ctx.settings, "queue.daily") - ctx.learner.today.queueWords - (ctx.queueUsed ?? 0));
  return [...ctx.learner.queue]
    .filter((row) => ctx.now.getTime() - Date.parse(row.addedAt) < expire)
    .sort((a, b) => QUEUE_ORDER[a.source] - QUEUE_ORDER[b.source] || Date.parse(a.addedAt) - Date.parse(b.addedAt))
    .map((row) => ctx.content.words.get(row.wordId))
    .filter((word): word is WordC => !!word && !ctx.taken(word.id) && ctx.content.openLevels.includes(word.level) && ready(word, ctx))
    .slice(0, room);
}

/** Standard words of lower levels not known yet, then the current level, by `intro_order` (rows 2 and 3). */
export function orderedWords(ctx: NewWordContext): WordC[] {
  const { content } = ctx;
  const vocab = ctx.learner.skills.find((skill) => skill.skill === "vocab");
  const current = levelIndex(content, vocab?.level ?? content.levels[0]);
  return [...content.words.values()]
    .filter((word) => hasCard(word) && !isColloquial(word) && levelIndex(content, word.level) <= current && content.openLevels.includes(word.level))
    .filter((word) => !ctx.taken(word.id) && !ctx.known(word.id))
    .sort((a, b) => levelIndex(content, a.level) - levelIndex(content, b.level) || a.introOrder - b.introOrder || a.id - b.id);
}

/**
 * The next `count` new words (PRD §5.8): the queue first, then the ordered list with sense, phrase
 * and family rules. `recent` is the newest-first list of words introduced before.
 */
export function nextNewWords(ctx: NewWordContext, count: number, recent: readonly number[]): { words: WordC[]; fromQueue: number } {
  const out: WordC[] = [];
  const queue = queueWords(ctx).slice(0, count);
  out.push(...queue);
  const gap = num(ctx.settings, `intro.family_gap.${ctx.content.language}`);
  let pool = orderedWords(ctx).filter((word) => !out.includes(word));
  const history = [...out.map((word) => word.id).reverse(), ...recent];
  while (out.length < count) {
    const usable = pool.filter((word) => ready(word, ctx));
    if (usable.length === 0) break;
    const lastFamilies = new Set(
      history
        .slice(0, gap)
        .map((id) => ctx.content.words.get(id)?.family)
        .filter(Boolean),
    );
    const pick = (gap > 0 && usable.find((word) => !word.family || !lastFamilies.has(word.family))) || usable[0];
    out.push(pick);
    history.unshift(pick.id);
    pool = pool.filter((word) => word !== pick);
  }
  return { words: out, fromQueue: queue.length };
}

/** The unit that opens next, or null (PRD §6.2): the first unit not opened, if the one before allows it. */
export function nextUnit(content: Content, units: Map<number, ItemStateE>, settings: Settings): UnitC | null {
  const rounds = num(settings, "grammar.unlock_after_rounds");
  let previous: ItemStateE | null = null;
  for (const unit of content.units) {
    const state = units.get(unit.id);
    if (state) {
      previous = state;
      continue;
    }
    if (!content.openLevels.includes(unit.level)) return null;
    if (previous === null) return unit;
    const allowed = previous.step >= 2 || previous.source === "i_know" || previous.roundsCount >= rounds;
    return allowed ? unit : null;
  }
  return null;
}

/** Conjugation cards that may be made (PRD §6.6): review card, its unit opened, its verb known. */
export function conjCandidates(content: Content, units: Map<number, ItemStateE>, conj: Map<number, ItemStateE>, known: (wordId: number) => boolean): ConjC[] {
  const opened = new Set(content.units.filter((unit) => units.has(unit.id)).map((unit) => unit.unitCode));
  return content.conjugations.filter((table) => table.reviewCard && !conj.has(table.id) && (!table.unitCode || opened.has(table.unitCode)) && known(table.wordId));
}

/** Colloquial words that join the queue when their standard word first reaches step 4 (PRD §5.4). */
export function colloquialFor(content: Content, word: WordC, stepBefore: number, stepAfter: number): WordC[] {
  if (stepBefore >= 4 || stepAfter < 4 || word.conceptId === null || !hasCard(word)) return [];
  return [...content.words.values()].filter((other) => other.conceptId === word.conceptId && isColloquial(other));
}

/** Introduced card words that count for the skill gates (PRD §10.3): `no_card` words do not count. */
export function introducedCardWords(content: Content, items: readonly ItemStateE[]): number {
  let count = 0;
  for (const item of items) {
    const word = item.itemType === "word" ? content.words.get(item.itemId) : undefined;
    if (word && hasCard(word)) count++;
  }
  return count;
}
