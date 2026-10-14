/**
 * Plays sessions with a made-up learner: the right answer or a wrong one for every exercise, and
 * every card through the same `playCard` the browser and the server use.
 */
import type { Content } from "../../src/engine/content";
import type { Ex, RawAnswer } from "../../src/engine/ex";
import type { Rng } from "../../src/engine/random";
import { buildSession, type BuildOptions, type BuildResult } from "../../src/engine/session/build";
import { playCard, shownEx, type PlayResult } from "../../src/engine/session/play";
import type { Card, SessionPlan } from "../../src/engine/session/types";
import type { Settings } from "../../src/engine/settings";
import type { LearnerSnapshot } from "../../src/engine/state";
import { tehranDate } from "../../src/engine/time";
import { newDay, record } from "./learner";

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

export type Policy = (card: Card, ex: Ex | null, rng: Rng) => { answer: RawAnswer; latencyMs: number };

export const always =
  (right: boolean): Policy =>
  (_card, ex) => ({ answer: ex ? (right ? rightAnswer(ex) : wrongAnswer(ex)) : { seen: true }, latencyMs: 6000 });

export const withAccuracy =
  (p: number): Policy =>
  (_card, ex, rng) => ({ answer: ex ? (rng() < p ? rightAnswer(ex) : wrongAnswer(ex)) : { seen: true }, latencyMs: 3000 + Math.floor(rng() * 9000) });

export type Played = { learner: LearnerSnapshot; plan: SessionPlan | null; results: Extract<PlayResult, { done: true }>[]; build: BuildResult };

/** Builds a session and plays every card with the policy. */
export function playSession(
  content: Content,
  learner0: LearnerSnapshot,
  settings: Settings,
  now: Date,
  opts: BuildOptions,
  policy: Policy,
  rng: Rng,
  onEach?: (plan: SessionPlan) => void,
): Played {
  const today = tehranDate(now);
  let learner = newDay(learner0, today);
  const build = buildSession(content, learner, settings, now, today, opts);
  if (build.kind !== "plan") return { learner, plan: null, results: [], build };
  learner = applyEffects(learner, build.effects, today);
  let plan = build.plan;
  const results: Extract<PlayResult, { done: true }>[] = [];
  let elapsed = 0;
  const wordsWithLemma = (lemma: string) => content.lemmaIndex.get(lemma) ?? [];
  for (let guard = 0; plan.queue.length > 0 && guard < 2000; guard++) {
    const card = plan.queue[0];
    const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" ? null : shownEx(plan, card);
    const { answer, latencyMs } = policy(card, ex, rng);
    const at = new Date(now.getTime() + elapsed * 1000);
    elapsed += latencyMs / 1000;
    const ctx = { settings, now: at, today, latency: plan.latency };
    let result = playCard(plan, card.id, answer, { latencyMs, elapsedSec: elapsed }, { ctx, language: content.language, wordsWithLemma });
    if (!result.done) result = playCard(plan, card.id, { idk: true }, { latencyMs, elapsedSec: elapsed }, { ctx, language: content.language, wordsWithLemma });
    if (!result.done) throw new Error("idk is always graded");
    learner = record(learner, result, settings, at, today, latencyMs);
    plan = result.advanced.plan;
    results.push(result);
    onEach?.(plan);
  }
  return { learner, plan, results, build };
}

/** What a build writes before the session starts (PRD §10.2): pace, spread backlog, the word cap. */
export function applyEffects(learner: LearnerSnapshot, effects: Extract<BuildResult, { kind: "plan" }>["effects"], today: string): LearnerSnapshot {
  const deferred = new Map(effects.spread.map((item) => [item.key, item.deferredUntil]));
  return {
    ...learner,
    enrollment: { ...learner.enrollment, paceMode: effects.paceMode, lastSpreadDate: effects.lastSpreadDate },
    items: learner.items.map((item) => {
      const key = `${item.itemType === "word" ? "w" : item.itemType === "grammar_unit" ? "u" : "c"}:${item.itemId}`;
      return deferred.has(key) ? { ...item, deferredUntil: deferred.get(key)! } : item;
    }),
    today: { ...learner.today, date: today, wordsCapToday: effects.wordsCapToday, capPromptShown: effects.capPromptShown },
  };
}
