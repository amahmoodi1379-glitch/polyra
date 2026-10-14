import { buildConjEx, buildColloquialEx, buildGrammarEx, buildWordEx, grammarCodeFits, knownShare, type BuildEnv, type GrammarSource } from "./build";
import { isColloquial, type ConjC, type TargetC, type UnitC, type WordC } from "./content";
import type { Ex } from "./ex";
import { codesAt, exerciseDef, SHAPE, type ExerciseFamily } from "./exercises";
import { pickOne, shuffle, type Rng } from "./random";
import { num } from "./settings";
import { itemKey, type ItemHistory } from "./state";

/**
 * Exercise choice (PRD §9.3) and the grammar round (§6.5).
 */

export type Purpose = "review" | "followup" | "practice";

/** The highest step of an item's ladder (PRD §5.3, §5.4, §6.5, §6.6). */
export function lastStepOfWord(word: WordC): number {
  if (isColloquial(word)) return 2;
  return word.mastery === "recognize" ? 3 : 6;
}

export function lastStepOfUnit(env: Pick<BuildEnv, "content">, unit: UnitC): number {
  const typedSix = env.content.transforms.some((item) => item.unitId === unit.id) || env.content.translates.some((item) => item.unitId === unit.id);
  return typedSix ? 6 : 5;
}

export const CONJ_LAST_STEP = 4;

const range = (from: number, to: number) => (from <= to ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : Array.from({ length: from - to + 1 }, (_, i) => from - i));

/** The steps exercise choice looks at, in order (PRD §9.3, step 3). */
export function stepOrder(step: number, last: number, purpose: Purpose): number[] {
  if (purpose === "followup") return range(step, last);
  return [step, ...(step > 1 ? range(step - 1, 1) : []), ...(step < last ? range(step + 1, last) : [])];
}

export type PickArgs = {
  family: ExerciseFamily;
  step: number;
  last: number;
  purpose: Purpose;
  /** A followup of a word that was already on its last step: only form exercises (PRD §9.3, step 2). */
  formOnly?: boolean;
  history: ItemHistory;
  rng: Rng;
  /** Exercises that need sound are left out (no voice on the device, or «الان نمی‌توانم گوش بدهم»). */
  audio: boolean;
  /** Builds the exercise, or null when its needs are not met (PRD §9.3, step 1). */
  build: (code: string) => Ex | null;
};

/** Steps 4 to 6 of PRD §9.3 on exercises that are all possible. */
export function chooseAmong(built: Ex[], history: ItemHistory, rng: Rng): Ex {
  let pool = built;
  if (pool.length > 1 && history.lastCode) {
    const without = pool.filter((ex) => ex.code !== history.lastCode);
    if (without.length > 0) pool = without;
  }
  const count = (ex: Ex) => history.codeCounts[ex.code] ?? 0;
  const least = Math.min(...pool.map(count));
  return pickOne(
    rng,
    pool.filter((ex) => count(ex) === least),
  );
}

export function pickExercise(args: PickArgs): Ex | null {
  const { family, purpose } = args;
  const keep = (code: string) => {
    const info = exerciseDef(code);
    if (!args.audio && info.audio) return false;
    if (family !== "word") return true;
    if (purpose === "review") return info.meaning;
    if (purpose === "followup" && args.formOnly) return !info.meaning;
    return true;
  };
  for (const step of stepOrder(args.step, args.last, purpose)) {
    const built = codesAt(family, step)
      .filter(keep)
      .map((code) => args.build(code))
      .filter((ex): ex is Ex => ex !== null);
    if (built.length > 0) return chooseAmong(built, args.history, args.rng);
  }
  return null;
}

/** One exercise for a word (PRD §9.3); a colloquial word uses its own two-step ladder (§5.4). */
export function pickWordEx(env: BuildEnv, word: WordC, step: number, purpose: Purpose, opts: { formOnly?: boolean; audio: boolean }): Ex | null {
  const colloquial = isColloquial(word);
  return pickExercise({
    family: colloquial ? "colloquial" : "word",
    step: Math.min(step, lastStepOfWord(word)),
    last: lastStepOfWord(word),
    purpose,
    formOnly: opts.formOnly,
    history: env.history(itemKey("word", word.id)),
    rng: env.rng,
    audio: opts.audio,
    build: (code) => (colloquial ? buildColloquialEx(env, word, code) : buildWordEx(env, word, code)),
  });
}

export function pickConjEx(env: BuildEnv, table: ConjC, step: number, purpose: Purpose, opts: { audio: boolean }): Ex | null {
  return pickExercise({
    family: "conjugation",
    step: Math.min(step, CONJ_LAST_STEP),
    last: CONJ_LAST_STEP,
    purpose,
    history: env.history(itemKey("conjugation", table.id)),
    rng: env.rng,
    audio: opts.audio,
    build: (code) => buildConjEx(env, table, code),
  });
}

/** A notebook sentence of a unit: one question from the unit's current step (PRD §9.5). */
export function pickTargetEx(env: BuildEnv, unit: UnitC, target: TargetC, step: number, opts: { audio: boolean }): Ex | null {
  const last = lastStepOfUnit(env, unit);
  return pickExercise({
    family: "grammar",
    step: Math.min(step, last),
    last,
    purpose: "practice",
    history: env.history(itemKey("grammar_unit", unit.id)),
    rng: env.rng,
    audio: opts.audio,
    build: (code) => buildGrammarEx(env, unit, code, { target }),
  });
}

// ───────────────────────────── grammar round ─────────────────────────────

/** `alts`: for each question that needs sound, the same sentence without it (PRD §10.12). */
export type Round = { unitId: number; step: number; questions: Ex[]; alts: (Ex | null)[] };

/** The sentences a round may use at this step, in the order of PRD §6.5 (rule 2). */
function roundSources(env: BuildEnv, unit: UnitC, step: number): GrammarSource[] {
  const { content } = env;
  if (step === 6) {
    const transforms = shuffle(
      env.rng,
      content.transforms.filter((item) => item.unitId === unit.id),
    ).map((transform): GrammarSource => ({ transform }));
    const translates = shuffle(
      env.rng,
      content.translates.filter((item) => item.unitId === unit.id),
    ).map((translate): GrammarSource => ({ translate }));
    // Taken in turn (rule 1).
    const out: GrammarSource[] = [];
    for (let i = 0; i < Math.max(transforms.length, translates.length); i++) {
      if (transforms[i]) out.push(transforms[i]);
      if (translates[i]) out.push(translates[i]);
    }
    return out;
  }
  const history = env.history(itemKey("grammar_unit", unit.id));
  const recent = new Set(history.recentSentences);
  const threshold = num(env.settings, "known.threshold");
  const targets = shuffle(env.rng, content.unitTargets.get(unit.id) ?? []).filter((target) => content.sentences.has(target.sentenceId));
  const seen = (target: TargetC) => env.sentenceSeen.get(target.sentenceId) ?? 0;
  const readable = (target: TargetC) => knownShare(content.sentences.get(target.sentenceId)!, env.known, null) >= threshold;
  const rank = (target: TargetC) => [recent.has(target.sentenceId) ? 1 : 0, readable(target) ? 0 : 1, seen(target)];
  return targets
    .map((target) => ({ target, key: rank(target) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
    .map(({ target }): GrammarSource => ({ target }));
}

/** Codes of a step in the order the round rotates through them: least used first, the last one used at the end. */
function rotation(env: BuildEnv, unit: UnitC, step: number, audio: boolean): string[] {
  const history = env.history(itemKey("grammar_unit", unit.id));
  const codes = shuffle(
    env.rng,
    codesAt("grammar", step).filter((code) => audio || !exerciseDef(code).audio),
  );
  const count = (code: string) => history.codeCounts[code] ?? 0;
  return codes.sort((a, b) => Number(a === history.lastCode) - Number(b === history.lastCode) || count(a) - count(b));
}

/** Five questions of one unit at one step, each with another code where possible (PRD §6.5). */
function roundAt(env: BuildEnv, unit: UnitC, step: number, audio: boolean): { ex: Ex; alt: Ex | null }[] {
  const codes = rotation(env, unit, step, audio);
  if (codes.length === 0) return [];
  const questions: { ex: Ex; alt: Ex | null }[] = [];
  let turn = 0;
  // G3a sorts items into the unit's categories: one question, no sentence (rule 5).
  if (codes.includes("G3a") && grammarCodeFits(env, "G3a", { sets: true }, unit)) {
    const ex = buildGrammarEx(env, unit, "G3a", { sets: true });
    if (ex) questions.push({ ex, alt: null });
  }
  const sentenceCodes = codes.filter((code) => code !== "G3a");
  if (sentenceCodes.length === 0) return questions;
  const silentCodes = sentenceCodes.filter((code) => !exerciseDef(code).audio);
  const usedSentences = new Set<number>();
  for (const source of roundSources(env, unit, step)) {
    if (questions.length >= SHAPE.roundSize) break;
    if ("target" in source && usedSentences.has(source.target.sentenceId)) continue;
    let ex: Ex | null = null;
    for (let i = 0; i < sentenceCodes.length && !ex; i++) {
      const code = sentenceCodes[(turn + i) % sentenceCodes.length];
      ex = buildGrammarEx(env, unit, code, source);
      // G3c without a readable sentence becomes G1a for the same sentence (rule 6).
      if (!ex && code === "G3c" && "target" in source) ex = buildGrammarEx(env, unit, "G1a", source);
    }
    if (!ex) continue;
    // A question that needs sound keeps a silent version of the same sentence for «الان نمی‌توانم گوش بدهم».
    let alt: Ex | null = null;
    for (let i = 0; ex.audio && i < silentCodes.length && !alt; i++) alt = buildGrammarEx(env, unit, silentCodes[(turn + i) % silentCodes.length], source);
    turn++;
    if ("target" in source) usedSentences.add(source.target.sentenceId);
    questions.push({ ex, alt });
  }
  return shuffle(env.rng, questions);
}

/**
 * A grammar round for a unit at its step. When the step cannot give three questions, the steps of
 * PRD §9.3 (lower first) are tried; null means the unit does not come in this session (§6.5, rule 7).
 */
export function buildRound(env: BuildEnv, unit: UnitC, step: number, opts: { audio: boolean }): Round | null {
  const last = lastStepOfUnit(env, unit);
  for (const at of stepOrder(Math.min(step, last), last, "review")) {
    const questions = roundAt(env, unit, at, opts.audio);
    if (questions.length >= SHAPE.roundMin) return { unitId: unit.id, step: at, questions: questions.map((item) => item.ex), alts: questions.map((item) => item.alt) };
  }
  return null;
}
