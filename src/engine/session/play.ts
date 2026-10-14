import { applyConfusion, applyRound, applySingle, newItemState, strongestPartner, type AnswerCtx, type RoundOutcome, type SingleOutcome } from "../answer";
import type { Ex, RawAnswer } from "../ex";
import { grade, type GradeOutcome, type Graded } from "../grade";
import type { NotebookOp } from "../notebook";
import { flag, num } from "../settings";
import { parseItemKey, type ConfusionE, type ItemStateE } from "../state";
import type { Lang } from "../text";
import { advance, type Advanced } from "./advance";
import type { Card, SessionPlan } from "./types";

/**
 * One finished card, from the raw answer to the next state of the session. The browser runs it to
 * show feedback and move on at once; the server runs it on the saved plan to grade again and to know
 * what to write (PRD §15.4). Only the plan is needed, never the whole content.
 */

export type PlayEnv = {
  ctx: AnswerCtx;
  language: Lang;
  /** Word ids with a lemma, for a typed answer that is another word (PRD §9.9). */
  wordsWithLemma: (lemma: string) => number[];
};

export type PlayLog = {
  kind: "intro" | "review" | "followup" | "practice";
  itemType: string | null;
  itemId: number | null;
  code: string | null;
  stepBefore: number | null;
  stepAfter: number | null;
  sentenceId: number | null;
  targetId: number | null;
  result: Graded["result"];
  reason: Graded["reason"];
  raw: string | null;
  chosenWordId: number | null;
  firstTyping: boolean;
  rating: number | null;
};

export type PlayResult =
  /** Not graded: a synonym gets one more try, Persian letters get the keyboard message (PRD §5.6). */
  | { done: false; outcome: Extract<GradeOutcome, { result: "synonym" | "persian" }> }
  | {
      done: true;
      card: Card;
      ex: Ex | null;
      graded: Graded | null;
      log: PlayLog;
      single: SingleOutcome | null;
      round: RoundOutcome | null;
      /** The state to write for the card's item, when it changed. */
      state: ItemStateE | null;
      /** A round's unit state, written when the round ended. */
      roundState: ItemStateE | null;
      notebook: NotebookOp[];
      /** The confusion pair to write (PRD §9.9). */
      pair: ConfusionE | null;
      advanced: Advanced;
    };

const RATING = { again: 1, hard: 2, good: 3, easy: 4 } as const;

/** The exercise the learner actually saw: the version without sound in a no-sound session. */
export const shownEx = (plan: SessionPlan, card: Card): Ex | null => (plan.noAudio && card.alt ? card.alt : (card.ex ?? null));

export function playCard(plan: SessionPlan, cardId: string, answer: RawAnswer, timing: { latencyMs: number; elapsedSec: number }, env: PlayEnv): PlayResult {
  const card = plan.queue[0];
  if (!card || card.id !== cardId) throw new Error(`Card ${cardId} is not the next card`);
  const { ctx } = env;
  const ex = shownEx(plan, card);
  const key = card.item;
  const parsed = key.startsWith("t:") ? null : parseItemKey(key);
  const base: PlayLog = {
    kind: "intro",
    itemType: parsed ? parsed.type : "grammar_target",
    itemId: parsed ? parsed.id : Number(key.slice(2)),
    code: ex?.code ?? null,
    stepBefore: null,
    stepAfter: null,
    sentenceId: ex?.sentenceId ?? null,
    targetId: ex?.targetId ?? null,
    result: "correct",
    reason: null,
    raw: null,
    chosenWordId: null,
    firstTyping: false,
    rating: null,
  };

  // Cards without a score (PRD §9.2, kind intro).
  if (card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion") {
    const advanced = advance(plan, { cardId, result: "seen", elapsedSec: timing.elapsedSec }, ctx.settings);
    return { done: true, card, ex: null, graded: null, log: { ...base, code: null }, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, advanced };
  }
  if (!ex) throw new Error(`Card ${cardId} has no exercise`);

  const outcome = grade(ex, answer, { language: env.language, wordsWithLemma: env.wordsWithLemma });
  if (outcome.result === "synonym" || outcome.result === "persian") return { done: false, outcome };
  const graded = outcome;

  // G0 warm-ups are never scored (PRD §6.5).
  if (card.t === "g0") {
    const advanced = advance(plan, { cardId, result: "seen", elapsedSec: timing.elapsedSec }, ctx.settings);
    return {
      done: true,
      card,
      ex,
      graded,
      log: { ...base, result: graded.result, raw: graded.raw },
      single: null,
      round: null,
      state: null,
      roundState: null,
      notebook: [],
      pair: null,
      advanced,
    };
  }

  // A grammar round question: scored with the whole round when it ends.
  if (card.t === "round") {
    const roundAnswer = { code: ex.code, result: graded.result, latencyMs: timing.latencyMs, targetId: ex.targetId };
    let advanced = advance(plan, { cardId, result: graded.result, round: roundAnswer, elapsedSec: timing.elapsedSec }, ctx.settings);
    let round: RoundOutcome | null = null;
    let roundState: ItemStateE | null = null;
    let notebook: NotebookOp[] = [];
    if (advanced.roundDone) {
      const before = plan.states[key] ?? newItemState("grammar_unit", parsed!.id, ctx.now);
      round = applyRound(before, advanced.roundDone.step, advanced.roundDone.answers, ctx, advanced.roundDone.last);
      notebook = round.notebook;
      if (round.scored) {
        roundState = round.state;
        advanced = { ...advanced, plan: { ...advanced.plan, states: { ...advanced.plan.states, [key]: round.state } } };
      }
    }
    const log: PlayLog = { ...base, kind: "review", result: graded.result, reason: graded.reason, raw: graded.raw, stepBefore: plan.states[key]?.step ?? 1 };
    return { done: true, card, ex, graded, log, single: null, round, state: null, roundState, notebook, pair: null, advanced };
  }

  // A notebook sentence of a unit: one practice question (PRD §9.5).
  if (key.startsWith("t:")) {
    const failed = graded.result === "wrong" || graded.result === "idk";
    const notebook: NotebookOp[] = graded.result === "near" ? [] : [{ op: failed ? "wrong" : "correct", refType: "grammar_target", refId: Number(key.slice(2)) }];
    const advanced = advance(plan, { cardId, result: graded.result, elapsedSec: timing.elapsedSec }, ctx.settings);
    const log: PlayLog = { ...base, kind: "practice", result: graded.result, reason: graded.reason, raw: graded.raw };
    return { done: true, card, ex, graded, log, single: null, round: null, state: null, roundState: null, notebook, pair: null, advanced };
  }

  // A word or a conjugation card.
  const type = parsed!.type;
  const id = parsed!.id;
  const before = plan.states[key] ?? newItemState(type, id, ctx.now);
  const item = plan.items[key];
  const gender = ex.code === "W2d" || (ex.a.kind === "type" && !!ex.a.gender);
  const kind = card.kind ?? "review";
  const applied = applySingle({ state: before, kind, code: ex.code, graded, latencyMs: timing.latencyMs, last: item?.last ?? 6, gender }, ctx);
  // «تمرین بیشتر» changes nothing: no notebook, no extra practice (PRD §10.8).
  const extra = plan.scope === "extra";
  const single: SingleOutcome = extra ? { ...applied, notebook: [], practice: false, genderPractice: false } : applied;

  // Another word chosen by mistake: a confusion pair (PRD §9.9).
  let pairs = plan.pairs;
  let pair: ConfusionE | null = null;
  let confusion: [number, number] | null = null;
  if (type === "word" && single.result === "wrong" && graded.chosenWordId && kind !== "practice" && !extra) {
    const self = plan.words[id]?.word;
    const other = plan.words[graded.chosenWordId]?.word ?? { id: graded.chosenWordId, lemma: `#${graded.chosenWordId}` };
    if (self) {
      const known = new Set(plan.pairsAtStart);
      const result = applyConfusion(pairs, self, other, ctx, (a, b) => known.has(`${a}:${b}`));
      pairs = result.pairs;
      pair = result.pair;
      if (result.showCard && result.pair) confusion = [result.pair.wordId, result.pair.otherWordId];
    }
  }
  let leechPartner: number | null = null;
  if (single.leech && type === "word" && flag(ctx.settings, "feature.confusion_card")) {
    leechPartner = strongestPartner(pairs, id, num(ctx.settings, "confusion.min_count"));
  }

  let advanced = advance(plan, { cardId, result: single.result, single, confusion, leechPartner, elapsedSec: timing.elapsedSec }, ctx.settings);
  advanced = { ...advanced, plan: { ...advanced.plan, states: { ...advanced.plan.states, [key]: single.state }, pairs } };
  const log: PlayLog = {
    ...base,
    kind,
    stepBefore: single.stepBefore,
    stepAfter: single.stepAfter,
    result: single.result,
    reason: single.reason,
    raw: graded.raw,
    chosenWordId: graded.chosenWordId,
    firstTyping: single.firstTyping,
    rating: single.rating ? RATING[single.rating] : null,
  };
  return { done: true, card, ex, graded, log, single, round: null, state: single.state, roundState: null, notebook: single.notebook, pair, advanced };
}
