import type { RoundAnswer, SingleOutcome } from "../answer";
import type { Ex } from "../ex";
import type { Graded } from "../grade";
import { num, type Settings } from "../settings";
import type { Card, SessionPlan } from "./types";

/**
 * Changes to the session after each finished card (PRD §10.7, "تغییرهای وسط جلسه", and §9.10,
 * §9.11). The browser runs it to move on at once; the server runs it again on the saved plan, so the
 * two stay the same. Nothing here reads the database or the clock.
 */

export type AdvanceEvent = {
  cardId: string;
  /** The final result; cards without a score (intro, lesson, table, confusion, G0) are "seen". */
  result: Graded["result"] | "seen";
  /** What `applySingle` decided, for an exercise of a word or a conjugation card. */
  single?: SingleOutcome | null;
  /** A grammar round question's answer. */
  round?: RoundAnswer | null;
  /** Show «این دو را قاطی می‌کنی» for this pair right after the feedback (PRD §9.9). */
  confusion?: [number, number] | null;
  /** The other word of a strong pair, shown after the leech card (PRD §9.11). */
  leechPartner?: number | null;
  /** A phonics round set aside at its start (PRD §8.4) or without sound at any card (§10.12): the rest of its block leaves the session. */
  skip?: "later" | "drop" | null;
  /** Seconds since the session's first card, for the time guard (PRD §10.7). */
  elapsedSec: number;
};

export type Advanced = {
  plan: SessionPlan;
  /** A round that just ended, to be scored with `applyRound`. */
  roundDone: { block: string; item: string; step: number; last: number; answers: RoundAnswer[] } | null;
  /** The phonics round just ended with its last question, every answer in (PRD §8.3). */
  phonicsDone: boolean;
  /** The rescue rule moved easy reviews to the front (PRD §9.10). */
  rescued: boolean;
  /** The low-accuracy rule dropped new material (PRD §9.10). */
  droppedNew: number;
  finished: boolean;
};

const EXERCISES = new Set<Card["t"]>(["ex", "g0", "round"]);

/**
 * Whether `card` may come right after `prev` (PRD §16.3, rule 14): never two exercises of one item in
 * a row, except an introduction (intro card, table, lesson) and its first exercise, and the questions
 * of one block.
 */
export function mayFollow(prev: Card | undefined, card: Card): boolean {
  if (!prev || prev.item !== card.item || !EXERCISES.has(card.t)) return true;
  return prev.t === "intro" || prev.t === "table" || prev.t === "lesson" || (!!card.block && prev.block === card.block);
}

/** Whether `card` fits before `queue[index]`, with `prev` the card shown just before the queue. */
function fitsAt(queue: Card[], index: number, card: Card, prev: Card): boolean {
  const after = queue[index];
  if (after?.block && index > 0 && queue[index - 1].block === after.block) return false;
  return mayFollow(index === 0 ? prev : queue[index - 1], card) && (!after || mayFollow(card, after));
}

/**
 * Puts a card at least `gap` cards later (PRD §10.7), never inside a block and never next to another
 * card of its item (rule 14): the first place from `gap` on, else the nearest one before it, so with
 * fewer cards left it goes last. `prev` is the card shown just before the queue. Null when no place
 * fits; the card is then left out.
 */
export function insertLater(queue: Card[], card: Card, gap: number, prev: Card): Card[] | null {
  const start = Math.min(gap, queue.length);
  const up = Array.from({ length: queue.length - start + 1 }, (_, i) => start + i);
  const down = Array.from({ length: start }, (_, i) => start - 1 - i);
  for (const index of [...up, ...down]) {
    if (!fitsAt(queue, index, card, prev)) continue;
    const out = [...queue];
    out.splice(index, 0, card);
    return out;
  }
  return null;
}

/**
 * A change to the queue (rescue, dropped new material, the time guard) can bring two cards of one
 * item together; the second moves to the next place that fits, or is left out. Only a followup or a
 * practice added during the session can be such a card: the plan has one entry per item.
 */
function keepApart(queue: Card[], prev: Card): Card[] {
  const out = [...queue];
  for (let index = 0; index < out.length; index++) {
    const card = out[index];
    if (card.block || mayFollow(out[index - 1] ?? prev, card)) continue;
    const rest = out.slice(index + 1);
    out.splice(index, out.length - index, ...(insertLater(rest, card, 1, out[index - 1] ?? prev) ?? rest));
    index--;
  }
  return out;
}

/** The two (or `rescue.easy_items`) easiest single reviews left, moved to `at` (PRD §9.10). */
function rescue(plan: SessionPlan, queue: Card[], at: number, settings: Settings): { queue: Card[]; moved: boolean } {
  const count = num(settings, "rescue.easy_items");
  const step = (card: Card) => plan.states[card.item]?.step ?? card.ex?.step ?? Number.POSITIVE_INFINITY;
  const candidates = queue
    .map((card, index) => ({ card, index }))
    .filter(({ card, index }) => index >= at && card.t === "ex" && card.kind === "review" && !card.block)
    .sort((a, b) => step(a.card) - step(b.card) || a.index - b.index)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map(({ card }) => card);
  if (candidates.length === 0) return { queue, moved: false };
  const rest = queue.filter((card) => !candidates.includes(card));
  rest.splice(at, 0, ...candidates);
  return { queue: rest, moved: true };
}

export function advance(plan: SessionPlan, event: AdvanceEvent, settings: Settings): Advanced {
  const [card, ...rest] = plan.queue;
  if (!card || card.id !== event.cardId) throw new Error(`Card ${event.cardId} is not the next card`);
  let queue = rest;
  const counters = { ...plan.counters, practice: { ...plan.counters.practice } };
  const rounds = { ...plan.rounds };
  let nextCard = plan.nextCard;
  const make = (fields: Omit<Card, "id">): Card => ({ id: `k${nextCard++}`, ...fields });
  let roundDone: Advanced["roundDone"] = null;
  let rescued = false;
  let droppedNew = 0;

  const scored = event.result !== "seen" && (card.kind === "review" || card.kind === "followup");
  const failed = event.result === "wrong" || event.result === "idk";
  // The end screen's right and wrong (PRD §3.9); «نمی‌دانم» is neither (PRD §3.5).
  if (card.t !== "g0") {
    if (event.result === "wrong") counters.wrong++;
    else if (event.result === "correct" || event.result === "near") counters.correct++;
  }
  if (scored) {
    counters.answered++;
    if (!failed) counters.ok++;
    counters.wrongStreak = failed ? counters.wrongStreak + 1 : 0;
  }

  // A round question: keep the answer; the last one ends the round.
  if (card.t === "round" && card.block && event.round) {
    const round = rounds[card.block];
    rounds[card.block] = { ...round, answers: [...round.answers, event.round] };
    if (card.roundEnd) roundDone = { block: card.block, ...rounds[card.block] };
  }
  // A phonics question: the same, scored by the share right when the last one is in (PRD §8.3).
  let phonics = plan.phonics ?? null;
  let phonicsDone = false;
  if (card.t === "phonicsq" && phonics && event.result !== "seen") {
    phonics = { ...phonics, answers: [...phonics.answers, event.result] };
    phonicsDone = !!card.roundEnd;
  }
  // «بعداً», or no sound now: the rest of the block goes, nothing else changes.
  if (event.skip && card.block) queue = queue.filter((other) => other.block !== card.block);

  // What the answer asks for next (PRD §10.7).
  const front: Card[] = [];
  const out = event.single;
  if (card.t === "ex" && out) {
    const item = plan.items[card.item];
    const gapFollow = num(settings, "followup.gap");
    const gapPractice = num(settings, "practice.gap");
    const maxPractice = num(settings, "practice.max_per_item");
    if (out.leech) {
      // Leech (PRD §9.9, §9.11): its practice goes; the intro card and maybe the pair card come now.
      queue = queue.filter((other) => !(other.item === card.item && other.kind === "practice"));
      front.push(make({ t: "intro", item: card.item, reason: "leech" }));
      if (event.leechPartner) front.push(make({ t: "confusion", item: card.item, pair: [Number(card.item.slice(2)), event.leechPartner] }));
    } else if (out.introAgain) {
      front.push(make({ t: "intro", item: card.item, reason: "again" }));
    }
    if (event.confusion && !out.leech) front.push(make({ t: "confusion", item: card.item, pair: event.confusion }));
    // The card goes after the cards put in front of the queue; a card with no place is left out.
    const prev = front.at(-1) ?? card;
    const later = (ex: Ex | null | undefined, alt: Ex | null | undefined, kind: Card["kind"], gap: number): boolean => {
      const placed = ex ? insertLater(queue, make({ t: "ex", item: card.item, kind, ex, alt: alt ?? null }), gap, prev) : null;
      if (placed) queue = placed;
      return !!placed;
    };
    if (out.followup && item) {
      if (out.followupFormOnly) later(item.followupForm, item.followupFormAlt, "followup", gapFollow);
      else later(item.followup, item.followupAlt, "followup", gapFollow);
    }
    const used = counters.practice[card.item] ?? 0;
    if (used < maxPractice && item) {
      const at = used % Math.max(1, item.fallback.length);
      const placed = out.practice ? later(item.fallback[at], item.fallbackAlt[at], "practice", gapPractice) : out.genderPractice && later(item.gender, null, "practice", gapPractice);
      if (placed) counters.practice[card.item] = used + 1;
    }
  }
  queue = [...front, ...queue];

  // Rescue after three wrong answers in a row; inside a round it waits for the round to end (DECISIONS.md).
  const inBlock = !!card.block && queue[front.length]?.block === card.block;
  if (scored && counters.wrongStreak >= num(settings, "rescue.wrong_streak")) {
    counters.wrongStreak = 0;
    if (inBlock) counters.rescuePending = true;
    else {
      const done = rescue(plan, queue, front.length, settings);
      queue = done.queue;
      rescued = done.moved;
    }
  } else if (counters.rescuePending && !inBlock) {
    counters.rescuePending = false;
    const done = rescue(plan, queue, front.length, settings);
    queue = done.queue;
    rescued = done.moved;
  }

  // Low accuracy: new material not started yet leaves the session (PRD §9.10).
  if (counters.answered >= num(settings, "rescue.min_answers") && counters.ok / counters.answered < num(settings, "rescue.session_accuracy")) {
    const started = new Set(card.block ? [card.block] : []);
    const before = queue.length;
    queue = queue.filter((other) => !(other.fresh && (!other.block || !started.has(other.block))));
    droppedNew = before - queue.length;
  }

  // Time guard: past 1.3 times the budget the remaining followups go (PRD §10.7, §9.11).
  if (event.elapsedSec > num(settings, "session.time_guard") * plan.budgetSec) queue = queue.filter((other) => other.kind !== "followup");

  queue = keepApart(queue, card);
  const next: SessionPlan = { ...plan, queue, rounds, counters, nextCard, doneCount: plan.doneCount + 1, ...(phonics ? { phonics } : {}) };
  return { plan: next, roundDone, phonicsDone, rescued, droppedNew, finished: queue.length === 0 };
}
