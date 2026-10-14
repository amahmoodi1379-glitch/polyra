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
  /** Seconds since the session's first card, for the time guard (PRD §10.7). */
  elapsedSec: number;
};

export type Advanced = {
  plan: SessionPlan;
  /** A round that just ended, to be scored with `applyRound`. */
  roundDone: { block: string; item: string; step: number; last: number; answers: RoundAnswer[] } | null;
  /** The rescue rule moved easy reviews to the front (PRD §9.10). */
  rescued: boolean;
  /** The low-accuracy rule dropped new material (PRD §9.10). */
  droppedNew: number;
  finished: boolean;
};

/**
 * Puts a card at least `gap` cards later, never inside a block: a position inside one moves to
 * after it. When fewer cards are left, the card goes last.
 */
export function insertLater(queue: Card[], card: Card, gap: number): Card[] {
  const out = [...queue];
  let index = Math.min(gap, out.length);
  while (index > 0 && index < out.length && out[index].block && out[index - 1].block === out[index].block) index++;
  out.splice(index, 0, card);
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
    const later = (ex: Ex | null | undefined, alt: Ex | null | undefined, kind: Card["kind"], gap: number) => {
      if (!ex) return;
      queue = insertLater(queue, make({ t: "ex", item: card.item, kind, ex, alt: alt ?? null }), gap);
    };
    if (out.followup && item) {
      if (out.followupFormOnly) later(item.followupForm, item.followupFormAlt, "followup", gapFollow);
      else later(item.followup, item.followupAlt, "followup", gapFollow);
    }
    const used = counters.practice[card.item] ?? 0;
    if (out.practice && item && used < maxPractice) {
      const ex = item.fallback[used % Math.max(1, item.fallback.length)];
      if (ex) {
        later(ex, item.fallbackAlt[used % Math.max(1, item.fallback.length)], "practice", gapPractice);
        counters.practice[card.item] = used + 1;
      }
    } else if (out.genderPractice && item?.gender && used < maxPractice) {
      later(item.gender, null, "practice", gapPractice);
      counters.practice[card.item] = used + 1;
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

  const next: SessionPlan = { ...plan, queue, rounds, counters, nextCard, doneCount: plan.doneCount + 1 };
  return { plan: next, roundDone, rescued, droppedNew, finished: queue.length === 0 };
}
