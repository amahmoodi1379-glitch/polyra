/**
 * The simulator (PRD §16.3, «شبیه‌ساز»): made-up learners of every pattern go through the real engine
 * on synthetic content, day by day, and the run is held against the pass marks of the PRD. It prints a
 * report and exits with 1 when a mark is missed.
 *
 *   npm run simulate                  every pattern, advanced features off and on
 *   npm run simulate -- --quick       a fifth of the learners and the features-off run only, for a fast look
 *   npm run simulate -- --seed=other  another seed
 *
 * Patterns that need later phases (placement samples, «این را بلدم», the end of the path) wait for
 * them; DECISIONS.md lists which.
 */
import { performance } from "node:perf_hooks";
import { buildConjEx, buildGrammarEx, buildWordEx, type BuildEnv, type GrammarSource } from "../src/engine/build";
import { hasCard, isColloquial, type Content } from "../src/engine/content";
import type { Ex } from "../src/engine/ex";
import { codesAt, exerciseDef, TRANSFORM_STEP } from "../src/engine/exercises";
import { checkInvariants, type InvariantInput } from "../src/engine/invariants";
import { lastStepOfWord } from "../src/engine/pick";
import { seeded } from "../src/engine/random";
import { textKnownShare } from "../src/engine/texts";
import { makeEnv } from "../src/engine/session";
import { buildSession, type BuildOptions } from "../src/engine/session/build";
import type { Card, Scope } from "../src/engine/session/types";
import type { Settings } from "../src/engine/settings";
import { isItemKey, parseItemKey, type LearnerSnapshot } from "../src/engine/state";
import { plusDays, tehranDate, tehranDayStart } from "../src/engine/time";
import { engineCatalog } from "../src/server/settings/engine-catalog";
import { syntheticContent } from "../fixtures/synthetic";
import { playSession } from "../fixtures/synthetic/drive";
import { human } from "../fixtures/synthetic/human";
import { freshLearner } from "../fixtures/synthetic/learner";

const args = new Map<string, string | undefined>(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const QUICK = args.has("quick");
const SEED = args.get("seed") ?? "polyra-sim";
const START = new Date("2026-03-21T04:30:00Z");
const ABILITIES = [0.9, 0.75, 0.55];
const LEVELS = ["A1", "A2", "B1", "B2"];

type Pattern = {
  name: string;
  count: number;
  days: number;
  length: number;
  start?: string;
  /** The sessions of a day, by scope; empty for a day away. */
  day: (day: number) => Scope[];
  /** Answer to the word-cap question. */
  cap: "more" | "none";
  /** Comes every day it is active (for the marks that speak of daily learners). */
  daily: boolean;
  /** Takes another pattern's seeds, to run its learners again with other days. */
  seedAs?: string;
};

const every = (scope: Scope) => () => [scope];
const PATTERNS: Pattern[] = [
  { name: "zero-10", count: 15, days: 60, length: 10, day: every("mixed"), cap: "none", daily: true },
  { name: "zero-15", count: 10, days: 60, length: 15, day: every("mixed"), cap: "none", daily: true },
  { name: "zero-30", count: 10, days: 60, length: 30, day: every("mixed"), cap: "none", daily: true },
  { name: "zero-10-quick", count: 10, days: 60, length: 10, day: (d) => [d % 7 === 2 || d % 7 === 5 ? "quick" : "mixed"], cap: "none", daily: true },
  { name: "zero-3-days", count: 15, days: 60, length: 10, day: (d) => (d % 7 === 0 || d % 7 === 2 || d % 7 === 4 ? ["mixed"] : []), cap: "none", daily: false },
  { name: "vocab-only", count: 10, days: 60, length: 10, day: every("vocab"), cap: "none", daily: true },
  { name: "a2-grammar", count: 10, days: 60, length: 10, start: "A2", day: every("grammar"), cap: "none", daily: true },
  { name: "b1-start", count: 10, days: 60, length: 10, start: "B1", day: every("mixed"), cap: "none", daily: true },
  // The absence learners first without the absence: what their pile would be had they never left.
  { name: "never-away", count: 10, days: 100, length: 10, day: every("mixed"), cap: "none", daily: true, seedAs: "absence" },
  { name: "absence", count: 10, days: 100, length: 10, day: (d) => (d < 15 || d >= 55 ? ["mixed"] : []), cap: "none", daily: true },
  { name: "hurried", count: 10, days: 60, length: 10, day: () => ["mixed", "mixed", "mixed", "mixed"], cap: "more", daily: true },
];

type Stats = {
  sessions: number;
  errors: string[];
  violations: Map<number, number>;
  /** nothing_left while the learner's content still had new words and the day's cap had room. */
  empty: number;
  newMaterial: { yes: number; of: number };
  firstSession: string[];
  scoredForm: number;
  stuck: { items: number; of: number };
  stepFour: number[];
  overdueDay60: number[];
  absence: string[];
  /** Overdue cards on the last day: of the absence learners, and of the same learners never away. */
  pileEnd: number[];
  slowDays: Map<number, { slow: number; of: number }>;
  leeches: Map<number, { leech: number; of: number }>;
  /** Exposures by `family:step:code`, only where at least three codes were possible (see `candidates`). */
  codes: Map<string, number>;
  wordsPerDay: Map<number, number[]>;
  unitsPerWeek: number[];
  seconds: Record<string, number>;
  a1Done: number[];
  firstReview: { ok: number; of: number };
  byStep: Map<number, { ok: number; of: number }>;
  hurriedQueue: number[];
  /** Phonics lessons done by day 30 and at the end, per learner from zero (PRD §8). */
  phonics: { day30: number[]; end: number[] };
  /** Per learner at the end: texts with a first round in each track, and the track levels. */
  texts: { listening: number[]; reading: number[]; levels: Map<string, number>; share: Map<string, number> };
};

const newStats = (): Stats => ({
  sessions: 0,
  errors: [],
  violations: new Map(),
  empty: 0,
  newMaterial: { yes: 0, of: 0 },
  firstSession: [],
  scoredForm: 0,
  stuck: { items: 0, of: 0 },
  stepFour: [],
  overdueDay60: [],
  absence: [],
  pileEnd: [],
  slowDays: new Map(),
  leeches: new Map(),
  codes: new Map(),
  wordsPerDay: new Map(),
  unitsPerWeek: [],
  seconds: {},
  a1Done: [],
  firstReview: { ok: 0, of: 0 },
  byStep: new Map(),
  hurriedQueue: [],
  phonics: { day30: [], end: [] },
  texts: { listening: [], reading: [], levels: new Map(), share: new Map() },
});

const bump = <K,>(map: Map<K, number>, key: K, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const ratio = (map: Map<number, { [k: string]: number; of: number }>, key: number, field: string, add: number) => {
  const entry = map.get(key) ?? { [field]: 0, of: 0 };
  entry[field] = (entry[field] ?? 0) + add;
  entry.of += 1;
  map.set(key, entry as { [k: string]: number; of: number });
};

/** Card words not introduced yet in the levels the learner may get (the next level opens with level-up). */
function newWordsLeft(content: Content, learner: LearnerSnapshot): boolean {
  const vocab = learner.skills.find((skill) => skill.skill === "vocab")!;
  const top = LEVELS.indexOf(vocab.level);
  const below = vocab.knownBelow ? LEVELS.indexOf(vocab.knownBelow) : 0;
  const taken = new Set(learner.items.filter((item) => item.itemType === "word").map((item) => item.itemId));
  for (const word of content.words.values()) {
    const at = LEVELS.indexOf(word.level);
    if (hasCard(word) && !isColloquial(word) && at <= top && at >= below && !taken.has(word.id)) return true;
  }
  return false;
}

/**
 * The codes exercise choice could take for this card (PRD §9.3, step 1): switched on and buildable
 * for this item at the exercise's step, for the card's purpose. The code-share mark looks only at
 * exposures with at least three of them; an item without a picture or a two-blank sentence has
 * fewer, and its one or two codes are not a fault of the choice.
 */
function candidates(env: BuildEnv, content: Content, card: Card, ex: Ex): number {
  // A notebook sentence (`t:`) is an exercise of its unit.
  if (!isItemKey(ex.item)) return 0;
  const { type, id } = parseItemKey(ex.item);
  const step = exerciseDef(ex.code).step;
  const family = exerciseDef(ex.code).family;
  if (type === "word") {
    const word = content.words.get(id);
    if (!word || family !== "word") return 0;
    const meaningOnly = card.kind === "review";
    return codesAt("word", step).filter((code) => (!meaningOnly || exerciseDef(code).meaning) && buildWordEx(env, word, code) !== null).length;
  }
  if (type === "conjugation") {
    const table = content.conjugations.find((item) => item.id === id);
    return table ? codesAt("conjugation", step).filter((code) => buildConjEx(env, table, code) !== null).length : 0;
  }
  if (type !== "grammar_unit" || family !== "grammar") return 0;
  const unit = content.units.find((item) => item.id === id);
  if (!unit) return 0;
  const sources: GrammarSource[] =
    step === TRANSFORM_STEP
      ? [...content.transforms.filter((item) => item.unitId === id).map((transform) => ({ transform })), ...content.translates.filter((item) => item.unitId === id).map((translate) => ({ translate }))]
      : (content.unitTargets.get(id) ?? []).map((target) => ({ target }));
  return codesAt("grammar", step).filter((code) => (code === "G3a" ? buildGrammarEx(env, unit, code, { sets: true }) !== null : sources.some((source) => buildGrammarEx(env, unit, code, source) !== null))).length;
}

/** Overdue cards each day of the never-away learners, by learner number, for their absent twins. */
type Twins = Map<number, number[]>;

function runLearner(pattern: Pattern, index: number, content: Content, settings: Settings, stats: Stats, days: number, twins: Twins) {
  const ability = ABILITIES[index % ABILITIES.length];
  const seed = `${SEED}:${pattern.seedAs ?? pattern.name}:${index}`;
  const rng = seeded(seed, "answers");
  const person = human({ content, settings, seed, ability: () => ability });
  // From zero, phonics rounds come by themselves (PRD §8.4).
  let learner = freshLearner("fr", { sessionLength: pattern.length, vocabLevel: pattern.start, knownBelow: pattern.start, phonicsAuto: !pattern.start });
  const stuck = new Map<string, { step: number; run: number; max: number; last: number }>();
  const leeched = new Set<string>();
  /** Cards due on an earlier day and not reviewed yet (deferred ones too: their FSRS due has passed). */
  const overdue = (day: Date) => {
    const start = tehranDayStart(tehranDate(day)).getTime();
    return learner.items.filter((item) => Date.parse(item.fsrs.due) < start).length;
  };
  let returnOverdue: number | null = null;
  /** Cards overdue on the day of the return, and when it was. */
  let leftBehind: string[] = [];
  let returnedAt: Date | null = null;
  let firstDone = false;
  let a1Done: number | null = null;
  const a1Words = [...content.words.values()].filter((word) => word.level === "A1" && hasCard(word) && !isColloquial(word)).length;

  for (let day = 0; day < days; day++) {
    const dayStart = plusDays(START, day);
    const scopes = pattern.day(day);
    if (pattern.name === "absence" && day >= 55) {
      const count = overdue(dayStart);
      if (day === 55) {
        returnOverdue = count;
        returnedAt = dayStart;
        const start = tehranDayStart(tehranDate(dayStart)).getTime();
        leftBehind = learner.items.filter((item) => Date.parse(item.fsrs.due) < start).map((item) => `${item.itemType}:${item.itemId}`);
      } else if (returnOverdue !== null && count > Math.max(returnOverdue, twins.get(index)?.[day] ?? 0)) {
        // Above the return day and above the same learner never away: the absence left a pile behind.
        stats.absence.push(`learner ${index}: ${count} overdue on day ${day}, ${returnOverdue} on return, ${twins.get(index)?.[day] ?? 0} never away`);
      }
      if (day === days - 1 && returnedAt) {
        const since = returnedAt.getTime();
        const waiting = leftBehind.filter((key) => {
          const item = learner.items.find((other) => `${other.itemType}:${other.itemId}` === key);
          return !!item && !(item.fsrs.last_review && Date.parse(item.fsrs.last_review) >= since);
        });
        if (waiting.length > 0) stats.absence.push(`learner ${index}: ${waiting.length} cards from the absence never reviewed`);
      }
    }
    if (day === days - 1) stats.pileEnd.push(overdue(dayStart));
    if (pattern.name === "never-away") twins.set(index, [...(twins.get(index) ?? []), overdue(dayStart)]);
    if (pattern.name === "hurried" && day === 14) stats.hurriedQueue.push(overdue(plusDays(dayStart, 1)));
    let wordsToday = 0;
    for (let k = 0; k < scopes.length; k++) {
      const now = new Date(dayStart.getTime() + (k * 2 + rng()) * 3_600_000);
      const opts: BuildOptions = { scope: scopes[k], lengthMin: learner.sessionLength, noAudio: false, cap: null, seed: `${seed}:${day}:${k}` };
      const check = (input: InvariantInput) => {
        for (const violation of checkInvariants(input)) bump(stats.violations, violation.rule);
      };
      const hadNewWords = newWordsLeft(content, learner);
      const before = learner;
      const wordsBefore = learner.today.date === tehranDate(now) ? learner.today.newWords : 0;
      try {
        let played = playSession(content, learner, settings, now, opts, person.policy, rng, { check });
        if (played.build.kind === "ask_word_cap") played = playSession(content, played.learner, settings, now, { ...opts, cap: pattern.cap }, person.policy, rng, { check });
        const build = played.build;
        stats.sessions++;
        if (pattern.name === "absence" && day === 55 && k === 0 && !(build.kind === "plan" && build.plan.summary.newItems > 0)) stats.absence.push(`learner ${index}: no new material in the first session back`);
        if (pattern.daily && ability >= 0.75 && pattern.name !== "hurried" && hadNewWords && scopes[k] === "mixed") {
          stats.newMaterial.of++;
          if (build.kind === "plan" && build.plan.summary.newItems > 0) stats.newMaterial.yes++;
        }
        if (build.kind === "nothing_left" && hadNewWords && scopes[k] !== "grammar" && scopes[k] !== "quick" && opts.cap !== "none" && wordsBefore < 20) stats.empty++;
        if (build.kind === "plan") ratio(stats.slowDays, ability, "slow", build.effects.paceMode === "slow" ? 1 : 0);
        if (!firstDone && build.kind === "plan") {
          firstDone = true;
          if (!pattern.start) {
            const shown = played.results.map((result) => result.ex).filter((ex) => !!ex);
            if (shown.some((ex) => ex.typed)) stats.firstSession.push(`learner ${index}: typed exercise`);
            if (played.results.some((result) => !result.card.item.startsWith("w:") && !result.card.item.startsWith("p:"))) stats.firstSession.push(`learner ${index}: grammar, listening or a text`);
            // T22: three words first, then the phonics round, then the rest; last when fewer words came.
            const lead = played.results.findIndex((result) => result.card.t === "phonics");
            const words = new Set(played.results.filter((result) => result.card.item.startsWith("w:")).map((result) => result.card.item));
            const before = new Set(played.results.slice(0, Math.max(0, lead)).map((result) => result.card.item));
            if (lead < 0) stats.firstSession.push(`learner ${index}: no phonics round`);
            else if (before.size !== Math.min(3, words.size)) stats.firstSession.push(`learner ${index}: phonics round after ${before.size} words`);
          }
        }
        // The learner before this session, as the build saw it, for the codes each card could have had.
        const env = makeEnv(content, before, settings, seeded(seed, "candidates", day, k));
        const possible = new Map<string, number>();
        played.results.forEach((result, at) => {
          const ex = result.ex;
          const seconds = played.latencies[at] / 1000;
          const skill =
            result.card.t === "drill"
              ? "listening"
              : result.card.text
                ? result.card.text.track
                : result.card.item.startsWith("w:")
                  ? "vocab"
                  : result.card.item.startsWith("p:")
                    ? "phonics"
                    : "grammar";
          stats.seconds[skill] = (stats.seconds[skill] ?? 0) + seconds;
          // A drill's code follows its count, not the choice (PRD §7.6).
          if (ex && ex.code !== "G0" && result.card.t !== "drill") {
            const def = exerciseDef(ex.code);
            const slot = `${result.card.item}:${def.step}:${result.card.kind ?? result.card.t}`;
            let count = possible.get(slot);
            if (count === undefined) possible.set(slot, (count = candidates(env, content, result.card, ex)));
            if (count >= 3) bump(stats.codes, `${def.family}:${def.step}:${ex.code}`);
          }
          // How much of a new text the learner knew when it came (PRD §7.5 condition 4 and its relaxing).
          if (result.card.text?.stage === "first" && result.card.text.attempt === 1 && !result.card.text.resume) {
            const text = content.texts.find((item) => item.id === result.card.text!.textId);
            const share = text ? textKnownShare(content, text, env.known) : 1;
            bump(stats.texts.share, share >= 0.9 ? "≥90%" : share >= 0.7 ? "70–90%" : share >= 0.5 ? "50–70%" : "<50%");
          }
          if (result.single?.leech) leeched.add(result.card.item);
          if (result.log.kind === "review" && result.log.rating !== null) {
            const ok = result.log.result === "correct" || result.log.result === "near" ? 1 : 0;
            if (result.card.item.startsWith("w:") && ex && !exerciseDef(ex.code).meaning) stats.scoredForm++;
            const step = result.log.stepBefore ?? 0;
            const entry = stats.byStep.get(step) ?? { ok: 0, of: 0 };
            stats.byStep.set(step, { ok: entry.ok + ok, of: entry.of + 1 });
            // The first review after the day of introduction: the item's second rating.
            if (result.state?.fsrs.reps === 2 && result.card.item.startsWith("w:")) {
              stats.firstReview.ok += ok;
              stats.firstReview.of++;
            }
            // An item that stays on one step for eight scored reviews in a row (not its last step).
            const key = result.card.item;
            const run = stuck.get(key) ?? { step: -1, run: 0, max: 0, last: 6 };
            const word = key.startsWith("w:") ? content.words.get(Number(key.slice(2))) : undefined;
            run.last = word ? lastStepOfWord(word) : 6;
            const after = result.log.stepAfter ?? step;
            run.run = after === step && step === run.step && step < run.last ? run.run + 1 : after === step && step < run.last ? 1 : 0;
            run.step = after;
            run.max = Math.max(run.max, run.run);
            stuck.set(key, run);
          }
        });
        learner = played.learner;
        wordsToday = learner.today.newWords;
      } catch (error) {
        stats.errors.push(`${pattern.name} learner ${index} day ${day}: ${(error as Error).message}`);
        return;
      }
    }
    if (scopes.length > 0) {
      const perDay = stats.wordsPerDay.get(Math.floor(day / 7) + 1) ?? [];
      perDay.push(wordsToday);
      stats.wordsPerDay.set(Math.floor(day / 7) + 1, perDay);
    }
    const words = learner.items.filter((item) => item.itemType === "word");
    if (a1Done === null && words.filter((item) => content.words.get(item.itemId)?.level === "A1").length >= a1Words) a1Done = day + 1;
    if (day === 29 && pattern.daily && ability === 0.75 && !pattern.start) stats.stepFour.push(words.filter((item) => item.step >= 4).length / Math.max(1, words.length));
    if (day === 29 && !pattern.start) stats.phonics.day30.push(learner.phonics.filter((state) => state.done).length);
    if (day === 59 && pattern.name === "zero-10" && ability >= 0.75) stats.overdueDay60.push(learner.items.filter((item) => Date.parse(item.fsrs.due) < plusDays(dayStart, -7).getTime()).length);
  }
  if (ability >= 0.75) {
    stats.stuck.of += stuck.size;
    stats.stuck.items += [...stuck.values()].filter((run) => run.max >= 8).length;
  }
  const entry = stats.leeches.get(ability) ?? { leech: 0, of: 0 };
  stats.leeches.set(ability, { leech: entry.leech + leeched.size, of: entry.of + learner.items.length });
  stats.unitsPerWeek.push((learner.items.filter((item) => item.itemType === "grammar_unit").length / days) * 7);
  if (a1Done !== null) stats.a1Done.push(a1Done);
  if (!pattern.start) stats.phonics.end.push(learner.phonics.filter((state) => state.done).length);
  for (const track of ["listening", "reading"] as const) {
    stats.texts[track].push(learner.texts.filter((state) => state.track === track && state.firstScore !== null).length);
    const level = learner.skills.find((skill) => skill.skill === track)?.level ?? "A1";
    bump(stats.texts.levels, `${track} ${level}`);
  }
}

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

type Mark = { name: string; ok: boolean; value: string };

function marks(all: Map<string, Stats>, buildMs: number, a1Only: { errors: string[]; nothingLeft: boolean }): Mark[] {
  const stats = [...all.values()];
  const sum = (pick: (s: Stats) => number) => stats.reduce((total, s) => total + pick(s), 0);
  const errors = stats.flatMap((s) => s.errors).concat(a1Only.errors);
  const empty = sum((s) => s.empty);
  const newYes = sum((s) => s.newMaterial.yes);
  const newOf = sum((s) => s.newMaterial.of);
  const first = stats.flatMap((s) => s.firstSession);
  const stuckItems = sum((s) => s.stuck.items);
  const stuckOf = sum((s) => s.stuck.of);
  const stepFour = stats.flatMap((s) => s.stepFour);
  const overdue = stats.flatMap((s) => s.overdueDay60);
  const absence = all.get("absence")?.absence ?? [];
  const pileAfter = median(all.get("absence")?.pileEnd ?? []);
  const pileNever = median(all.get("never-away")?.pileEnd ?? []);
  const violations = sum((s) => [...s.violations.values()].reduce((a, b) => a + b, 0));
  const slow = stats.map((s) => s.slowDays.get(0.9)).filter((x) => !!x);
  const slowShare = slow.reduce((a, x) => a + x.slow, 0) / Math.max(1, slow.reduce((a, x) => a + x.of, 0));
  // Code share: among the exposures of one ladder step where at least three codes were possible.
  const codeShares: string[] = [];
  let worst = 0;
  const perStep = new Map<string, Map<string, number>>();
  for (const s of stats) for (const [key, n] of s.codes) {
    const [family, step, code] = key.split(":");
    const map = perStep.get(`${family}:${step}`) ?? new Map<string, number>();
    bump(map, code, n);
    perStep.set(`${family}:${step}`, map);
  }
  for (const [key, map] of perStep) {
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    const [code, top] = [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = top / total;
    worst = Math.max(worst, share);
    codeShares.push(`${key} ${code} ${pct(share)}`);
  }
  return [
    { name: "errors and empty sessions while content is left", ok: errors.length === 0 && empty === 0, value: `${errors.length} errors, ${empty} empty${errors.length ? `; first: ${errors[0]}` : ""}` },
    { name: "sessions with new material (daily, a ≥ 0.75, content left) > 90%", ok: newOf === 0 || newYes / newOf > 0.9, value: `${newYes}/${newOf} = ${pct(newYes / Math.max(1, newOf))}` },
    { name: "first session from zero (T22): three words, then the phonics round; no typing, no grammar, no text", ok: first.length === 0, value: first.length ? first.slice(0, 3).join("; ") : "ok" },
    { name: "scored word review with a form exercise: zero", ok: sum((s) => s.scoredForm) === 0, value: String(sum((s) => s.scoredForm)) },
    { name: "grammar-only learner (A2): no empty session", ok: (all.get("a2-grammar")?.empty ?? 0) === 0, value: String(all.get("a2-grammar")?.empty ?? 0) },
    { name: "cards over 7 days overdue on day 60 (10 min, a ≥ 0.75): median ≤ 30, never > 150", ok: median(overdue) <= 30 && Math.max(0, ...overdue) <= 150, value: `median ${median(overdue)}, max ${Math.max(0, ...overdue)}` },
    {
      name: "40 days away: new material in the first session back, overdue never above both the return day and the same learner never away, every card from the absence reviewed, and 45 days later no bigger a pile than the same learners never away (median)",
      ok: absence.length === 0 && pileAfter <= pileNever,
      value: `${absence.length ? `${absence.slice(0, 2).join("; ")}; ` : ""}pile ${pileAfter}, never left ${pileNever}`,
    },
    { name: "items stuck 8 scored reviews on one step (a ≥ 0.75) < 2%", ok: stuckItems / Math.max(1, stuckOf) < 0.02, value: `${stuckItems}/${stuckOf} = ${pct(stuckItems / Math.max(1, stuckOf))}` },
    { name: "words at step ≥ 4 on day 30 (a = 0.75, daily) > 50%", ok: mean(stepFour) > 0.5, value: pct(mean(stepFour)) },
    { name: "one code's share of a step with ≥ 3 possible codes < 40%", ok: worst < 0.4, value: codeShares.join(", ") },
    { name: "build time with 10,000 item states < 300 ms", ok: buildMs < 300, value: `${buildMs.toFixed(0)} ms` },
    { name: "slow-pace share for a = 0.90 daily < 10%", ok: slowShare < 0.1, value: pct(slowShare) },
    { name: "A1-only content: a learner who finished everything gets «nothing left»", ok: a1Only.nothingLeft && a1Only.errors.length === 0, value: a1Only.nothingLeft ? "ok" : "never reached" },
    { name: "broken rules (checkInvariants): zero", ok: violations === 0, value: stats.flatMap((s) => [...s.violations].map(([rule, n]) => `rule ${rule}: ${n}`)).join(", ") || "0" },
  ];
}

/** Build time on a learner with 10,000 item states (PRD §16.3). */
function buildTime(settings: Settings): number {
  const content = syntheticContent({ words: 10_000, units: 20 });
  const now = plusDays(START, 200);
  let learner = freshLearner("fr", { sessionLength: 30 });
  const rng = seeded(SEED, "build-time");
  const items = [...content.words.values()].filter((word) => !word.noCard).slice(0, 10_000);
  learner = {
    ...learner,
    items: items.map((word) => {
      const due = plusDays(now, Math.floor(rng() * 40) - 20).toISOString();
      return {
        itemType: "word" as const,
        itemId: word.id,
        step: 1 + Math.floor(rng() * 6),
        fsrs: { due, stability: 5 + rng() * 30, difficulty: 5, elapsed_days: 0, scheduled_days: 10, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: plusDays(now, -10).toISOString() },
        probation: "none" as const,
        source: "normal" as const,
        introducedAt: plusDays(now, -60).toISOString(),
        firstReviewDone: true,
        typedOnce: true,
        deferredUntil: null,
        nearStreak: 0,
        failCount: 0,
        roundsCount: 0,
      };
    }),
  };
  const today = tehranDate(now);
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const at = performance.now();
    buildSession(content, { ...learner, enrollment: { ...learner.enrollment, lastSpreadDate: today } }, settings, now, today, { scope: "mixed", lengthMin: 30, noAudio: false, cap: null, seed: `bt${i}` });
    times.push(performance.now() - at);
  }
  return median(times);
}

/**
 * A small A1-only course that strong 30-minute learners finish (PRD §16.3, «اجرای فقط‌A1»): once no
 * word and no sentence to hear is left, coming back the same day after the session finds nothing.
 */
function a1OnlyRun(settings: Settings): { errors: string[]; nothingLeft: boolean } {
  const content = syntheticContent({ levels: ["A1"], words: 120, units: 4 });
  const errors: string[] = [];
  let nothingLeft = false;
  for (let index = 0; index < 3; index++) {
    const seed = `${SEED}:a1:${index}`;
    const rng = seeded(seed, "answers");
    const person = human({ content, settings, seed, ability: () => 0.95 });
    let learner = freshLearner("fr", { sessionLength: 30 });
    for (let day = 0; day < 90; day++) {
      const now = plusDays(START, day);
      const opts: BuildOptions = { scope: "mixed", lengthMin: 30, noAudio: false, cap: null, seed: `${seed}:${day}` };
      try {
        let played = playSession(content, learner, settings, now, opts, person.policy, rng);
        if (played.build.kind === "ask_word_cap") played = playSession(content, played.learner, settings, now, { ...opts, cap: "more" }, person.policy, rng);
        learner = played.learner;
        const later = new Date(now.getTime() + 3 * 3_600_000);
        const again = played.build.kind === "nothing_left" ? played.build : buildSession(content, learner, settings, later, tehranDate(later), { ...opts, seed: `${opts.seed}:again` });
        if (again.kind === "nothing_left" && !newWordsLeft(content, learner)) nothingLeft = true;
      } catch (error) {
        errors.push(`A1-only learner ${index} day ${day}: ${(error as Error).message}`);
        break;
      }
    }
  }
  return { errors, nothingLeft };
}

function report(label: string, all: Map<string, Stats>, content: Content) {
  console.log(`\n── ${label}: speed and behaviour (not pass marks) ──`);
  for (const [name, s] of all) {
    const week = (w: number) => mean(s.wordsPerDay.get(w) ?? []).toFixed(1);
    const total = Object.values(s.seconds).reduce((a, b) => a + b, 0) || 1;
    const time = Object.entries(s.seconds)
      .map(([skill, sec]) => `${skill} ${pct(sec / total)}`)
      .join(" ");
    const slow = ABILITIES.map((a) => `${a}: ${pct((s.slowDays.get(a)?.slow ?? 0) / Math.max(1, s.slowDays.get(a)?.of ?? 0))}`).join(" ");
    const leech = ABILITIES.map((a) => `${a}: ${pct((s.leeches.get(a)?.leech ?? 0) / Math.max(1, s.leeches.get(a)?.of ?? 0))}`).join(" ");
    const steps = [...s.byStep.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([step, e]) => `${step}:${pct(e.ok / Math.max(1, e.of))}`)
      .join(" ");
    console.log(
      `${name.padEnd(14)} sessions ${String(s.sessions).padStart(5)} · new words/day w1 ${week(1)} w4 ${week(4)} w8 ${week(8)} · units/week ${mean(s.unitsPerWeek).toFixed(2)} · time ${time} · A1 done day ${s.a1Done.length ? median(s.a1Done) : "-"}`,
    );
    console.log(`${"".padEnd(14)} slow ${slow} · leech ${leech} · first review ${pct(s.firstReview.ok / Math.max(1, s.firstReview.of))} · by step ${steps}`);
    const levels = [...s.texts.levels.entries()]
      .sort()
      .map(([key, n]) => `${key}×${n}`)
      .join(" ");
    const shares = ["≥90%", "70–90%", "50–70%", "<50%"].map((band) => `${band} ${s.texts.share.get(band) ?? 0}`).join(", ");
    console.log(`${"".padEnd(14)} first rounds per learner: listening ${median(s.texts.listening)}, reading ${median(s.texts.reading)} (median) · track levels ${levels} · known words of new texts: ${shares}`);
    if (s.phonics.end.length > 0) console.log(`${"".padEnd(14)} phonics lessons done (median of ${content.phonics.length}): day 30 ${median(s.phonics.day30)}, end ${median(s.phonics.end)}`);
    if (name === "hurried") console.log(`${"".padEnd(14)} review queue 14 days in: median ${median(s.hurriedQueue)}`);
  }
}

function run(label: string, settings: Settings): Mark[] {
  const content = syntheticContent({ perLevel: { words: [600, 300, 300, 300], units: [50, 30, 30, 30] }, textsPerLevel: 20, phonics: 14 });
  const all = new Map<string, Stats>();
  const twins: Twins = new Map();
  for (const pattern of PATTERNS) {
    const stats = newStats();
    const count = QUICK ? Math.max(3, Math.ceil(pattern.count / 5)) : pattern.count;
    const { days } = pattern;
    const at = performance.now();
    for (let index = 0; index < count; index++) runLearner(pattern, index, content, settings, stats, days, twins);
    all.set(pattern.name, stats);
    console.log(`${label} · ${pattern.name}: ${count} learners, ${days} days, ${((performance.now() - at) / 1000).toFixed(1)} s`);
  }
  report(label, all, content);
  const out = marks(all, buildTime(settings), a1OnlyRun(settings));
  console.log(`\n── ${label}: pass marks ──`);
  for (const mark of out) console.log(`${mark.ok ? "PASS" : "FAIL"}  ${mark.name}: ${mark.value}`);
  return out;
}

const defaults: Settings = Object.fromEntries(engineCatalog.map((item) => [item.key, item.default]));
const results = [
  ...run("features off", defaults),
  ...(QUICK ? [] : run("features on", { ...defaults, "feature.confusion_card": true, "feature.pretest": true, "feature.leveldown": true })),
];
const failed = results.filter((mark) => !mark.ok);
console.log(failed.length ? `\n${failed.length} pass mark(s) missed.` : "\nEvery pass mark met.");
process.exit(failed.length ? 1 : 0);
