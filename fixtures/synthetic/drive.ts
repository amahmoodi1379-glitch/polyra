/**
 * Plays sessions with a made-up learner: the right answer or a wrong one for every exercise, and
 * every card through the same `playCard` the browser and the server use.
 */
import type { Content } from "../../src/engine/content";
import type { Ex, RawAnswer } from "../../src/engine/ex";
import type { InvariantInput } from "../../src/engine/invariants";
import type { Rng } from "../../src/engine/random";
import { buildSession, type BuildEffects, type BuildOptions, type BuildResult } from "../../src/engine/session/build";
import { playCard, shownEx, wantsAlt, type PlayResult } from "../../src/engine/session/play";
import type { Card, SessionPlan } from "../../src/engine/session/types";
import type { Settings } from "../../src/engine/settings";
import { itemKey, type LearnerSnapshot } from "../../src/engine/state";
import { folds, type Lang } from "../../src/engine/text";
import { tehranDate } from "../../src/engine/time";
import { closeLeft, finishLevels, newDay, record } from "./learner";

export function rightAnswer(ex: Ex): RawAnswer {
  const spec = ex.a;
  switch (spec.kind) {
    case "choice":
    case "spot":
      return { choice: spec.correct };
    case "choice2":
      return { choices: spec.correct };
    case "type":
      return { text: spec.accepted[0], gender: spec.gender?.correct ?? null };
    case "letters":
      return { letters: spec.hidden.map((i) => [...spec.word][i]) };
    case "tiles":
      return { tiles: spec.orders[0] };
    case "pairs":
      return { firstPair: spec.pairs[spec.target] };
    case "sort":
      return { firstSort: Object.fromEntries(spec.items.map((item) => [item.id, item.set])) };
    case "table":
      return { rows: spec.rows.map((row) => row.accepted?.[0] ?? "") };
  }
}

export function wrongAnswer(ex: Ex): RawAnswer {
  const spec = ex.a;
  if (spec.kind === "choice") return { choice: spec.options.find((option) => option.id !== spec.correct)!.id };
  if (ex.idk) return { idk: true };
  if (spec.kind === "pairs") return { firstPair: spec.right.find((item) => item.id !== spec.pairs[spec.target])!.id };
  if (spec.kind === "sort") return { firstSort: Object.fromEntries(spec.items.map((item) => [item.id, item.set + 1])) };
  return { idk: true };
}

/** A typed answer one small slip away (PRD §5.6): without accents, or a German noun in lower case. Null when there is none. */
export function nearAnswer(ex: Ex, language: Lang): RawAnswer | null {
  if (ex.a.kind !== "type") return null;
  const right = ex.a.accepted[0];
  const [folded] = folds(right);
  if (folded !== right) return { text: folded, gender: ex.a.gender?.correct ?? null };
  if (language === "de" && /^\p{Lu}/u.test(right) && !ex.a.sentence) return { text: right.toLowerCase(), gender: ex.a.gender?.correct ?? null };
  return null;
}

/** A wrong answer of the kind a learner gives: a wrong option, a typo, or «نمی‌دانم». */
export function slipAnswer(ex: Ex, rng: Rng): RawAnswer {
  const spec = ex.a;
  if (ex.idk && rng() < 0.3) return { idk: true };
  if (spec.kind === "type") return { text: `${spec.accepted[0].slice(0, -2)}qx`, gender: spec.gender?.buttons.find((button) => button !== spec.gender?.correct) ?? null };
  if (spec.kind === "letters") return { letters: spec.hidden.map(() => "q") };
  if (spec.kind === "table") return { rows: spec.rows.map((row) => (row.accepted ? "qx" : "")) };
  if (spec.kind === "tiles") return { tiles: [...spec.orders[0]].reverse() };
  return wrongAnswer(ex);
}

/** How a made-up learner answers a card; `plan` and `at` let a model of memory look at the item's state. */
export type Policy = (card: Card, ex: Ex | null, rng: Rng, info: { plan: SessionPlan; at: Date }) => { answer: RawAnswer; latencyMs: number };

/** Right with probability `p` (a tenth of the typed ones a near slip), else a wrong option, a typo or «نمی‌دانم». */
export const randomPolicy =
  (p: number, language: Lang): Policy =>
  (_card, ex, rng) => {
    const latencyMs = 2000 + Math.floor(rng() * 14000);
    if (!ex) return { answer: { seen: true }, latencyMs };
    if (rng() >= p) return { answer: slipAnswer(ex, rng), latencyMs };
    return { answer: (rng() < 0.1 && nearAnswer(ex, language)) || rightAnswer(ex), latencyMs };
  };

export const always =
  (right: boolean): Policy =>
  (_card, ex) => ({ answer: ex ? (right ? rightAnswer(ex) : wrongAnswer(ex)) : { seen: true }, latencyMs: 6000 });

export const withAccuracy =
  (p: number): Policy =>
  (_card, ex, rng) => ({ answer: ex ? (rng() < p ? rightAnswer(ex) : wrongAnswer(ex)) : { seen: true }, latencyMs: 3000 + Math.floor(rng() * 9000) });

export type Played = {
  learner: LearnerSnapshot;
  plan: SessionPlan | null;
  results: Extract<PlayResult, { done: true }>[];
  /** Milliseconds each card took, beside `results`. */
  latencies: number[];
  build: BuildResult;
  left: boolean;
};

export type PlayOptions = {
  /** Leave after this many cards: the session closes the way the server closes it. */
  leaveAfter?: number;
  /** «الان نمی‌توانم گوش بدهم» after this many cards (PRD §10.12). */
  muteAfter?: number;
  /** Called after the build and after every card with what `checkInvariants` takes. */
  check?: (input: InvariantInput) => void;
};

/** Builds a session and plays its cards with the policy. */
export function playSession(content: Content, learner0: LearnerSnapshot, settings: Settings, now: Date, opts: BuildOptions, policy: Policy, rng: Rng, play: PlayOptions = {}): Played {
  const today = tehranDate(now);
  const before = newDay(learner0, today);
  const build = buildSession(content, before, settings, now, today, opts);
  // The server writes a build's effects whatever it returns (pace, spread, the word cap).
  let learner = applyEffects(before, build.effects, today);
  play.check?.({ content, settings, learner, now, today, build: { result: build, opts, before } });
  if (build.kind !== "plan") return { learner, plan: null, results: [], latencies: [], build, left: false };
  let plan = build.plan;
  const results: Extract<PlayResult, { done: true }>[] = [];
  const latencies: number[] = [];
  let elapsed = 0;
  const wordsWithLemma = (lemma: string) => content.lemmaIndex.get(lemma) ?? [];
  for (let index = 0; plan.queue.length > 0 && index < 2000; index++) {
    const at = new Date(now.getTime() + elapsed * 1000);
    if (play.leaveAfter !== undefined && index >= play.leaveAfter) {
      learner = closeLeft(learner, plan, settings, at, today);
      play.check?.({ content, settings, learner, now: at, today });
      return { learner, plan, results, latencies, build, left: true };
    }
    const card = plan.queue[0];
    const alt = wantsAlt(plan, card, { muted: play.muteAfter !== undefined && index >= play.muteAfter, noVoice: false, waitedSec: null }, settings);
    const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" ? null : shownEx(plan, card, alt);
    const { answer, latencyMs } = policy(card, ex, rng, { plan, at });
    elapsed += latencyMs / 1000;
    const ctx = { settings, now: at, today, latency: plan.latency };
    const timing = { latencyMs, elapsedSec: elapsed, alt };
    let result = playCard(plan, card.id, answer, timing, { ctx, language: content.language, wordsWithLemma });
    if (!result.done) result = playCard(plan, card.id, { idk: true }, timing, { ctx, language: content.language, wordsWithLemma });
    if (!result.done) throw new Error("idk is always graded");
    learner = record(learner, result, settings, at, today, latencyMs);
    play.check?.({ content, settings, learner, now: at, today, played: { result, plan, alt } });
    plan = result.advanced.plan;
    results.push(result);
    latencies.push(latencyMs);
  }
  if (plan.queue.length === 0) learner = finishLevels(learner, content, settings);
  return { learner, plan, results, latencies, build, left: false };
}

/** What a build writes before the session starts (PRD §10.2): pace, spread backlog, the word cap. */
export function applyEffects(learner: LearnerSnapshot, effects: BuildEffects, today: string): LearnerSnapshot {
  const deferred = new Map(effects.spread.map((item) => [item.key, item.deferredUntil]));
  return {
    ...learner,
    enrollment: { ...learner.enrollment, paceMode: effects.paceMode, lastSpreadDate: effects.lastSpreadDate },
    items: learner.items.map((item) => {
      const key = itemKey(item.itemType, item.itemId);
      return deferred.has(key) ? { ...item, deferredUntil: deferred.get(key)! } : item;
    }),
    today: { ...learner.today, date: today, wordsCapToday: effects.wordsCapToday, capPromptShown: effects.capPromptShown },
  };
}
