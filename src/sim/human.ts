/**
 * The simulator's learner (PRD §16.3, «شبیه‌ساز»): the chance of a right answer is
 * p = g + (1 − g) × R × a × d, with g the chance of a guess, R the real chance of recall from the FSRS
 * forgetting curve with the item's stability times a fixed random number between 0.7 and 1.3 (so the
 * engine's model and the "human" differ), a the learner's ability and d how hard the kind of exercise
 * is: 1 to choose, 0.85 to type, 0.7 for the first typed review of an item. In typed exercises 5% of
 * the right answers turn into a typo and 10% into a near answer. Each answer takes the exercise's time
 * from PRD §10.1, 30% either way. A text question has no memory curve: g + (1 − g) × a × d.
 * A learner who came out of placement knew the placement sample's words and sentences before (PRD §11.4):
 * those have no memory curve either, g + (1 − g) × `prior` × d, with no first-typing penalty. Such a learner
 * knew each new item with the chance `prior`: on those «این را بلدم» is pressed where offered, and a
 * «پیش‌آزمون» or the first review of the claim is right with g + (1 − g) × 0.95 × d; on the others it is a guess.
 */
import type { Content, QuestionC } from "@/engine/content";
import type { AnswerSpec, Ex } from "@/engine/ex";
import { isNewCard, retrievability } from "@/engine/fsrs";
import { seeded, type Rng } from "@/engine/random";
import type { Card } from "@/engine/session/types";
import { num, type Settings } from "@/engine/settings";
import type { ItemStateE } from "@/engine/state";
import { nearAnswer, productionAnswer, rightAnswer, slipAnswer, textAnswers, type Policy } from "./answers";

const DAY_MS = 86_400_000;
/** FSRS-4.5's curve, for an item that was introduced but never rated (its first exercise failed). */
const curve = (days: number, stability: number) => Math.pow(1 + ((19 / 81) * days) / stability, -0.5);
/** The chance of a right answer on an item the learner knew before the course. */
const KNEW = 0.95;
/** Stability of an introduced item that has no rating yet, in days. */
const FIRST_STABILITY = 1;

/** The chance of a blind guess. */
function guess(spec: AnswerSpec): number {
  if (spec.kind === "choice") return 1 / spec.options.length;
  if (spec.kind === "spot") return 1 / spec.parts.length;
  if (spec.kind === "choice2") return 1 / (spec.groups[0].length * spec.groups[1].length);
  return 0;
}

/** The chance of guessing a text question (PRD §7.3). */
function questionGuess(question: QuestionC): number {
  if (question.type === "mcq" || question.type === "ctx") return 1 / question.options.length;
  if (question.type === "tf") return 0.5;
  return 0;
}

/** Writing the answer is harder than choosing it, as `d` of the exercises. */
const questionHardness = (question: QuestionC) => (question.type === "num" || question.type === "dict" || question.type === "cloze" ? 0.85 : 1);

export type Human = {
  policy: Policy;
  /** The human memory's multiplier of one item, fixed for the learner. */
  factor: (key: string) => number;
};

export function human(opts: { content: Content; settings: Settings; seed: string; ability: (card: Card) => number; prior?: number }): Human {
  const { content, settings } = opts;
  const factors = new Map<string, number>();
  const factor = (key: string) => {
    let value = factors.get(key);
    if (value === undefined) factors.set(key, (value = 0.7 + 0.6 * seeded(opts.seed, key)()));
    return value;
  };
  /** Whether the learner knew a new item before, by `prior`, fixed for the learner. */
  const known = (key: string) => opts.prior !== undefined && seeded(opts.seed, "known", key)() < opts.prior;
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
    // A text stage: its share of the attempt's time; each question g + (1 − g) × a × d, a little easier with help.
    if (card.t === "text" && card.text) {
      const info = card.text;
      const latencyMs = Math.round((info.cost / (info.attempt === 1 ? 2 : 1)) * (0.7 + 0.6 * rng()) * 1000);
      const a = opts.ability(card);
      const help = info.stage === "help" ? 1.15 : 1;
      return { answer: textAnswers(plan, card, rng, (question) => questionGuess(question) + (1 - questionGuess(question)) * Math.min(1, a * questionHardness(question) * help)), latencyMs };
    }
    // Speaking: the learner's ability alone (PRD §8b); a dialogue takes its turns' time.
    if (card.prod) {
      const secs = card.prod.kind === "dialogue" ? card.prod.view.turns.length * num(settings, "time.dialogue_turn") : num(settings, card.prod.kind === "speak" ? "time.speak" : "time.errorfix");
      return { answer: productionAnswer(card, rng, opts.ability(card)), latencyMs: Math.round(secs * (0.7 + 0.6 * rng()) * 1000) };
    }
    const latencyMs = Math.round(seconds(card, ex) * (0.7 + 0.6 * rng()) * 1000);
    // A learner who knew some of the level presses «این را بلدم» on a new item they knew (PRD §11.5).
    if (opts.prior !== undefined && (card.t === "intro" || card.t === "lesson") && card.probationStep && (plan.counters.iknowLeft ?? 0) > 0 && known(card.item)) return { answer: { iknow: true }, latencyMs };
    if (!ex) return { answer: { seen: true }, latencyMs };
    const key = owner(card.item);
    const state = plan.states[key];
    const g = guess(ex.a);
    // An item claimed known (PRD §11.5) or asked in a «پیش‌آزمون»: right when the learner knew it, else a guess.
    if (opts.prior !== undefined && (card.t === "pretest" || plan.states[card.item]?.probation === "single")) {
      const p = known(card.item) ? g + (1 - g) * KNEW * (ex.typed ? 0.85 : 1) : g;
      return { answer: rng() < p ? rightAnswer(ex) : slipAnswer(ex, rng), latencyMs };
    }
    // The placement sample's words and sentences.
    if (opts.prior !== undefined && (card.item.startsWith("g:") || plan.states[card.item]?.probation === "sample")) {
      const p = g + (1 - g) * opts.prior * (ex.typed ? 0.85 : 1);
      if (rng() >= p) return { answer: slipAnswer(ex, rng), latencyMs };
      return { answer: rightAnswer(ex), latencyMs };
    }
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
