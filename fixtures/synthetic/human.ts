/**
 * The simulator's learner (PRD §16.3, «شبیه‌ساز»): the chance of a right answer is
 * p = g + (1 − g) × R × a × d, with g the chance of a guess, R the real chance of recall from the FSRS
 * forgetting curve with the item's stability times a fixed random number between 0.7 and 1.3 (so the
 * engine's model and the "human" differ), a the learner's ability and d how hard the kind of exercise
 * is: 1 to choose, 0.85 to type, 0.7 for the first typed review of an item. In typed exercises 5% of
 * the right answers turn into a typo and 10% into a near answer. Each answer takes the exercise's time
 * from PRD §10.1, 30% either way.
 */
import type { Content } from "../../src/engine/content";
import type { AnswerSpec, Ex } from "../../src/engine/ex";
import { isNewCard, retrievability } from "../../src/engine/fsrs";
import { seeded, type Rng } from "../../src/engine/random";
import type { Card } from "../../src/engine/session/types";
import { num, type Settings } from "../../src/engine/settings";
import type { ItemStateE } from "../../src/engine/state";
import { nearAnswer, rightAnswer, slipAnswer, type Policy } from "./drive";

const DAY_MS = 86_400_000;
/** FSRS-4.5's curve, for an item that was introduced but never rated (its first exercise failed). */
const curve = (days: number, stability: number) => Math.pow(1 + ((19 / 81) * days) / stability, -0.5);
/** Stability of an introduced item that has no rating yet, in days. */
const FIRST_STABILITY = 1;

/** The chance of a blind guess. */
function guess(spec: AnswerSpec): number {
  if (spec.kind === "choice") return 1 / spec.options.length;
  if (spec.kind === "spot") return 1 / spec.parts.length;
  if (spec.kind === "choice2") return 1 / (spec.groups[0].length * spec.groups[1].length);
  return 0;
}

export type Human = {
  policy: Policy;
  /** The human memory's multiplier of one item, fixed for the learner. */
  factor: (key: string) => number;
};

export function human(opts: { content: Content; settings: Settings; seed: string; ability: (card: Card) => number }): Human {
  const { content, settings } = opts;
  const factors = new Map<string, number>();
  const factor = (key: string) => {
    let value = factors.get(key);
    if (value === undefined) factors.set(key, (value = 0.7 + 0.6 * seeded(opts.seed, key)()));
    return value;
  };
  /** A grammar sentence of the notebook is remembered with its unit. */
  const owner = (key: string) => {
    if (!key.startsWith("t:")) return key;
    const target = content.targets.get(Number(key.slice(2)));
    return target ? `u:${target.targetId}` : key;
  };
  const recall = (state: ItemStateE | null | undefined, key: string, at: Date): number => {
    if (!state) return 1;
    if (isNewCard(state.fsrs)) {
      const since = state.introducedAt ? (at.getTime() - Date.parse(state.introducedAt)) / DAY_MS : 0;
      return curve(Math.max(0, since), FIRST_STABILITY * factor(key));
    }
    return retrievability({ ...state.fsrs, stability: state.fsrs.stability * factor(key) }, at, settings);
  };
  const seconds = (card: Card, ex: Ex | null) => {
    if (ex) return ex.time;
    if (card.t === "lesson") return num(settings, "time.grammar_lesson");
    return num(settings, "time.intro_card");
  };

  const policy: Policy = (card, ex, rng: Rng, { plan, at }) => {
    const latencyMs = Math.round(seconds(card, ex) * (0.7 + 0.6 * rng()) * 1000);
    if (!ex) return { answer: { seen: true }, latencyMs };
    const key = owner(card.item);
    const state = plan.states[key];
    const g = guess(ex.a);
    const firstTyped = ex.recall && card.kind === "review" && !!state && !state.typedOnce;
    const d = !ex.typed ? 1 : firstTyped ? 0.7 : 0.85;
    const p = g + (1 - g) * recall(state, key, at) * opts.ability(card) * d;
    if (rng() >= p) return { answer: slipAnswer(ex, rng), latencyMs };
    if (ex.typed) {
      const slip = rng();
      if (slip < 0.05) return { answer: slipAnswer(ex, rng), latencyMs };
      if (slip < 0.15) return { answer: nearAnswer(ex, content.language) ?? rightAnswer(ex), latencyMs };
    }
    return { answer: rightAnswer(ex), latencyMs };
  };
  return { policy, factor };
}
