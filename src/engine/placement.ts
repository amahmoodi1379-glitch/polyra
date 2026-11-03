import { PROBATION_STEP, probationState } from "./answer";
import { buildGrammarEx, buildWordEx, grammarCodeFits, type BuildEnv } from "./build";
import { hasCard, isColloquial, levelIndex, type Content, type TargetC, type TextC, type Track, type UnitC, type WordC } from "./content";
import type { Ex } from "./ex";
import type { Graded } from "./grade";
import { seeded, shuffle, type Rng } from "./random";
import { num, type Settings } from "./settings";
import { itemKey, type ItemStateE, type SkillLevelE, type SkillName } from "./state";
import { stageRules, type StageRules } from "./texts";
import { oneLetterOff } from "./text";
import { addDays, tehranDayStart } from "./time";

/**
 * Placement (PRD §11.1–§11.4): the one test a learner may take when starting a language, and the
 * typed sample that checks it afterwards. Pure: the server keeps `PlacementState` in
 * `placement_run.result` while the test runs and asks this module for the next question, the effect
 * of an answer and, at the end, the result and the sample.
 *
 * Words of a block: one at random from each of `placement.block_size` equal parts of the level's card
 * words by `intro_order`, asked with W1a. Grammar: G1a, one target from each of `block_size` units
 * evenly spaced in the level's order; a level with fewer units asks more targets of the same units
 * (DECISIONS.md). Texts: one `placement_ok` text per track from the level below `L`, set A.
 */

/** Rules of PRD §11 that are part of the method, not tunable numbers (DECISIONS.md: formula numbers are named). */
export const PLACEMENT_RULE = {
  /** A `placement_ok` text has at least four questions in set A of the track (PRD §7.7, §11.2). */
  textMinQuestions: 4,
  /** Grammar has at most two blocks (PRD §11.2). */
  grammarBlocks: 2,
  /** The texts are heard and read as attempt 2 (PRD §11.2: normal speed, two plays). */
  textAttempt: 2,
  /** The vocabulary sample is due over three days, a third each (PRD §11.4). */
  sampleDays: 3,
  /** The grammar sample comes in two rounds, today and tomorrow (PRD §11.4). */
  grammarRounds: 2,
} as const;

export { PROBATION_STEP };

export type PlacementPart = "vocab" | "grammar" | "texts" | "done";

/** A block of `placement.block_size` questions of one level (PRD §11.2). `items`: word ids or target ids. */
export type BlockState = { part: "vocab" | "grammar"; level: string; items: number[]; asked: number; right: number; wrong: number };

/** A finished block, for the result screen and the panel. */
export type BlockRecord = { part: "vocab" | "grammar"; level: string; asked: number; right: number; size: number; passed: boolean };

/** A text of the third part: which, in which track, and its score once answered. */
export type TextRecord = { track: Track; textId: number; level: string; score: number | null };

export type PlacementAsk =
  | { kind: "question"; part: "vocab" | "grammar"; level: string; number: number; size: number; ex: Ex }
  | { kind: "text"; track: Track; level: string; textId: number; rules: StageRules };

export type PlacementState = {
  version: 1;
  seed: string;
  part: PlacementPart;
  block: BlockState | null;
  blocks: BlockRecord[];
  /** The level below `L` the texts come from, once the third part starts. */
  textLevel: string | null;
  texts: TextRecord[];
  /** The question on screen, kept so the answer is graded against what was shown. */
  current: PlacementAsk | null;
  /** «ادامه نمی‌دهم» (PRD §11.2): the block on screen failed, parts not started take the lowest level. */
  stopped: boolean;
  /** Questions asked so far, for a seed of its own per question. */
  count: number;
};

export type PlacementResult = {
  /** `P_v`: the highest vocabulary level passed, or null. */
  pv: string | null;
  fv: string;
  fg: string;
  listening: string;
  reading: string;
  /** «سطح تو بالاتر از…» (PRD §11.3): above the whole path (the language's last level) or above today's content. */
  above: "path" | "content" | null;
  phonicsAuto: boolean;
  /** Texts used, each in its track: `used_in_test` (PRD §11.2). */
  texts: { textId: number; track: Track }[];
  blocks: BlockRecord[];
  stopped: boolean;
};

// ───────────────────────────── levels ─────────────────────────────

const cardWordsOf = (content: Content, level: string): WordC[] =>
  [...content.words.values()].filter((word) => hasCard(word) && !isColloquial(word) && word.level === level).sort((a, b) => a.introOrder - b.introOrder || a.id - b.id);

/** Levels the test asks about (PRD §11.1): the open levels (published, or approved for a tester) that have card words. */
export function placementLevels(content: Content): string[] {
  return content.levels.filter((level) => content.openLevels.includes(level) && cardWordsOf(content, level).length > 0);
}

const before = (content: Content, level: string) => content.levels[Math.max(0, levelIndex(content, level) - 1)];
const after = (content: Content, level: string) => content.levels[Math.min(content.levels.length - 1, levelIndex(content, level) + 1)];
const lower = (content: Content, a: string, b: string) => (levelIndex(content, a) <= levelIndex(content, b) ? a : b);
const lowest = (content: Content) => content.levels[0];

/** An environment for building one placement question: no help, wrong options up to the block's level. */
export function placementEnv(content: Content, settings: Settings, rng: Rng, level: string): BuildEnv {
  let n = 0;
  return {
    content,
    settings,
    vocabLevel: level,
    known: () => true,
    introduced: new Set(),
    history: () => ({ codeCounts: {}, lastCode: null, recentSentences: [] }),
    sentenceSeen: new Map(),
    confusionPartner: () => null,
    rng,
    nextId: () => `p${++n}`,
  };
}

// ───────────────────────────── blocks ─────────────────────────────

/** How many right answers pass a block of `size` and how many wrong ones end it (PRD §11.2: 8 of 10, the third wrong). */
export function blockMarks(settings: Settings, size: number): { need: number; failAt: number } {
  const full = num(settings, "placement.block_size");
  const pass = num(settings, "placement.pass_min");
  const need = size >= full ? pass : Math.max(1, Math.ceil((pass * size) / full));
  return { need, failAt: size - need + 1 };
}

/** One word from each of `block_size` equal parts of the level's list (PRD §11.2). */
export function vocabBlockItems(content: Content, level: string, settings: Settings, rng: Rng): number[] {
  const words = cardWordsOf(content, level).filter((word) => word.meanings.length > 0);
  const size = Math.min(num(settings, "placement.block_size"), words.length);
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const from = Math.floor((i * words.length) / size);
    const to = Math.floor(((i + 1) * words.length) / size);
    out.push(words[from + Math.floor(rng() * (to - from))].id);
  }
  return out;
}

/** Single-blank targets of a unit a code can be built from. */
function unitTargets(env: BuildEnv, unit: UnitC, code: string): TargetC[] {
  return (env.content.unitTargets.get(unit.id) ?? []).filter((target) => target.blanks === 1 && grammarCodeFits(env, code, { target }, unit));
}

/**
 * Targets of different units evenly spaced in the level's order (PRD §11.2, §11.4); with fewer units
 * than `size`, the units are gone through again with another target each, while there are any.
 */
export function spreadTargets(env: BuildEnv, level: string, code: string, size: number): number[] {
  const units = env.content.units.filter((unit) => unit.level === level).map((unit) => ({ unit, targets: shuffle(env.rng, unitTargets(env, unit, code)) }));
  const usable = units.filter((entry) => entry.targets.length > 0);
  if (usable.length === 0) return [];
  const out: number[] = [];
  if (usable.length >= size) {
    for (let i = 0; i < size; i++) out.push(usable[Math.floor((i * usable.length) / size)].targets[0].id);
    return out;
  }
  for (let round = 0; out.length < size; round++) {
    const before = out.length;
    for (const entry of usable) if (out.length < size && entry.targets[round]) out.push(entry.targets[round].id);
    if (out.length === before) break;
  }
  return out;
}

function newBlock(content: Content, settings: Settings, state: PlacementState, part: "vocab" | "grammar", level: string): BlockState {
  const rng = seeded(state.seed, "block", part, level);
  const items =
    part === "vocab" ? vocabBlockItems(content, level, settings, rng) : spreadTargets(placementEnv(content, settings, rng, level), level, "G1a", num(settings, "placement.block_size"));
  return { part, level, items, asked: 0, right: 0, wrong: 0 };
}

const blockOver = (settings: Settings, block: BlockState) => {
  const { failAt } = blockMarks(settings, block.items.length);
  return block.asked >= block.items.length || block.wrong >= failAt;
};

const recordOf = (settings: Settings, block: BlockState, stopped = false): BlockRecord => ({
  part: block.part,
  level: block.level,
  asked: block.asked,
  right: block.right,
  size: block.items.length,
  passed: !stopped && block.items.length > 0 && block.right >= blockMarks(settings, block.items.length).need,
});

// ───────────────────────────── the run ─────────────────────────────

export function startPlacement(content: Content, settings: Settings, seed: string): PlacementState {
  const state: PlacementState = { version: 1, seed, part: "vocab", block: null, blocks: [], textLevel: null, texts: [], current: null, stopped: false, count: 0 };
  return moveOn(content, settings, state);
}

const vocabPassed = (state: PlacementState) => state.blocks.filter((block) => block.part === "vocab" && block.passed).map((block) => block.level);
const grammarBlocks = (state: PlacementState) => state.blocks.filter((block) => block.part === "grammar");

/** `P_v`: the highest vocabulary level passed (PRD §11.2). */
function pvOf(content: Content, state: PlacementState): string | null {
  const passed = vocabPassed(state);
  return passed.length ? passed.reduce((a, b) => (levelIndex(content, a) >= levelIndex(content, b) ? a : b)) : null;
}

function fvOf(content: Content, state: PlacementState): { fv: string; above: boolean } {
  const pv = pvOf(content, state);
  if (pv === null) return { fv: lowest(content), above: false };
  const levels = placementLevels(content);
  if (pv === levels.at(-1)) return { fv: pv, above: true };
  return { fv: after(content, pv), above: false };
}

/** `F_g` from the grammar blocks (PRD §11.2), never above `F_v`; the lowest when the part did not run. */
function fgOf(content: Content, state: PlacementState): string {
  const pv = pvOf(content, state);
  const { fv } = fvOf(content, state);
  const blocks = grammarBlocks(state);
  if (pv === null || blocks.length === 0) return lowest(content);
  let fg: string;
  if (blocks[0].passed) fg = fv;
  else if (levelIndex(content, pv) <= 0) fg = lowest(content);
  else if (blocks[1]?.passed) fg = pv;
  else fg = before(content, pv);
  return lower(content, fg, fv);
}

/** Starts the next block or part, or ends the test (PRD §11.2). */
function moveOn(content: Content, settings: Settings, state: PlacementState): PlacementState {
  const next = { ...state };
  for (;;) {
    if (next.part === "vocab") {
      const levels = placementLevels(content);
      const last = next.blocks.filter((block) => block.part === "vocab").at(-1);
      if (last && !last.passed) {
        next.part = "grammar";
        continue;
      }
      const level = last ? levels[levels.indexOf(last.level) + 1] : levels[0];
      if (!level) {
        next.part = "grammar";
        continue;
      }
      next.block = newBlock(content, settings, next, "vocab", level);
      if (next.block.items.length === 0) {
        next.blocks = [...next.blocks, recordOf(settings, next.block)];
        next.block = null;
        next.part = "grammar";
        continue;
      }
      return next;
    }
    if (next.part === "grammar") {
      const pv = pvOf(content, next);
      const blocks = grammarBlocks(next);
      // No level passed: grammar is not asked, F_g is the lowest level.
      const level =
        pv === null
          ? null
          : blocks.length === 0
            ? pv
            : blocks.length < PLACEMENT_RULE.grammarBlocks && !blocks[0].passed && levelIndex(content, pv) > 0
              ? before(content, pv)
              : null;
      if (level === null) {
        next.part = "texts";
        continue;
      }
      const block = newBlock(content, settings, next, "grammar", level);
      if (block.items.length === 0) {
        // A level with nothing to ask is not held against the learner (DECISIONS.md).
        next.blocks = [...next.blocks, { ...recordOf(settings, block), passed: true }];
        continue;
      }
      next.block = block;
      return next;
    }
    if (next.part === "texts") {
      if (next.textLevel === null) {
        const L = lower(content, fvOf(content, next).fv, fgOf(content, next));
        if (levelIndex(content, L) <= 0) {
          next.part = "done";
          continue;
        }
        next.textLevel = before(content, L);
        const rng = seeded(next.seed, "texts");
        const used = new Set<number>();
        const texts: TextRecord[] = [];
        for (const track of ["listening", "reading"] as Track[]) {
          const pool = content.texts.filter(
            (text) => text.level === next.textLevel && text.placementOk && !used.has(text.id) && text.questions[track].A.length >= PLACEMENT_RULE.textMinQuestions,
          );
          if (pool.length === 0) continue;
          const text = pool[Math.floor(rng() * pool.length)];
          used.add(text.id);
          texts.push({ track, textId: text.id, level: text.level, score: null });
        }
        next.texts = texts;
      }
      if (next.texts.some((text) => text.score === null)) return next;
      next.part = "done";
      continue;
    }
    next.block = null;
    next.current = null;
    return next;
  }
}

/** The question on screen, made when first asked for and kept until it is answered. */
export function placementNext(content: Content, settings: Settings, state: PlacementState): { state: PlacementState; ask: PlacementAsk | null } {
  if (state.part === "done") return { state, ask: null };
  if (state.current) return { state, ask: state.current };
  if (state.part === "texts") {
    const record = state.texts.find((text) => text.score === null)!;
    const text = content.texts.find((item) => item.id === record.textId);
    if (!text) {
      // The text left the content since: it counts as not passed.
      return placementNext(content, settings, placementAnswer(content, settings, { ...state, current: textAsk(record, null) }, { score: 0 }));
    }
    const ask = textAsk(record, text);
    return { state: { ...state, current: ask }, ask };
  }
  const block = state.block!;
  const rng = seeded(state.seed, "q", state.count);
  const env = placementEnv(content, settings, rng, block.level);
  const id = block.items[block.asked];
  let ex: Ex | null = null;
  if (block.part === "vocab") {
    const word = content.words.get(id);
    ex = word ? buildWordEx(env, word, "W1a") : null;
  } else {
    const target = content.targets.get(id);
    const unit = target ? content.units.find((item) => item.id === target.targetId) : undefined;
    ex = target && unit ? buildGrammarEx(env, unit, "G1a", { target }) : null;
  }
  if (!ex) {
    // Content changed under the test, or a word with too few wrong options: the question leaves the block.
    const shrunk = { ...block, items: block.items.filter((_, i) => i !== block.asked) };
    if (shrunk.items.length > 0 && !blockOver(settings, shrunk)) return placementNext(content, settings, { ...state, block: shrunk });
    return placementNext(content, settings, moveOn(content, settings, { ...state, block: null, blocks: [...state.blocks, recordOf(settings, shrunk)] }));
  }
  ex = { ...ex, idk: true, q: stripHelp(ex.q) };
  const ask: PlacementAsk = { kind: "question", part: block.part, level: block.level, number: block.asked + 1, size: block.items.length, ex };
  return { state: { ...state, current: ask, count: state.count + 1 }, ask };
}

/** No touch for a meaning and no translation under a grammar sentence (PRD §11.1: no help in the test). */
function stripHelp(q: Ex["q"]): Ex["q"] {
  if (!q.sentence) return q;
  return { ...q, sentence: { ...q.sentence, glosses: [], translation: null } };
}

function textAsk(record: TextRecord, text: TextC | null): PlacementAsk {
  const rules = text ? stageRules(text, record.track, PLACEMENT_RULE.textAttempt, "again") : { plays: null, slow: false, bySentence: false, translations: false, wordTap: false, timedSec: null, revise: false };
  return { kind: "text", track: record.track, level: record.level, textId: record.textId, rules };
}

/**
 * The answer to the question on screen: a graded result for a question («نمی‌دانم» and wrong are both
 * not right), the stage's score for a text.
 */
export function placementAnswer(content: Content, settings: Settings, state: PlacementState, answer: Graded["result"] | { score: number }): PlacementState {
  const ask = state.current;
  if (!ask) throw new Error("No placement question is on screen");
  if (ask.kind === "text") {
    if (typeof answer !== "object") throw new Error("A text takes a score");
    const texts = state.texts.map((text) => (text.textId === ask.textId && text.track === ask.track ? { ...text, score: answer.score } : text));
    return moveOn(content, settings, { ...state, texts, current: null });
  }
  if (typeof answer === "object") throw new Error("A question takes a result");
  const right = answer === "correct" || answer === "near";
  const block = { ...state.block!, asked: state.block!.asked + 1, right: state.block!.right + (right ? 1 : 0), wrong: state.block!.wrong + (right ? 0 : 1) };
  if (!blockOver(settings, block)) return { ...state, block, current: null };
  return moveOn(content, settings, { ...state, block: null, current: null, blocks: [...state.blocks, recordOf(settings, block)] });
}

/**
 * «ادامه نمی‌دهم» and «از همین‌جا شروع کن» (PRD §11.1, §11.2): the block on screen fails, a second
 * grammar block that would follow fails with it, and parts not started keep the lowest level.
 */
export function placementStop(content: Content, settings: Settings, state: PlacementState): PlacementState {
  if (state.part === "done") return state;
  let blocks = state.blocks;
  if (state.block) blocks = [...blocks, recordOf(settings, state.block, true)];
  return { ...state, part: "done", block: null, current: null, blocks, stopped: true };
}

/** The four skills after the test (PRD §11.2, §11.3). */
export function placementResult(content: Content, settings: Settings, state: PlacementState): PlacementResult {
  const pv = pvOf(content, state);
  const { fv, above } = fvOf(content, state);
  const fg = grammarBlocks(state).length > 0 ? fgOf(content, state) : lowest(content);
  const textLevel = state.textLevel;
  const skill = (track: Track): string => {
    if (textLevel === null) return lowest(content);
    const record = state.texts.find((text) => text.track === track);
    // No suitable text: the level below `L` (PRD §11.2). Not reached after «ادامه نمی‌دهم»: the lowest level.
    if (!record) return textLevel;
    if (record.score === null) return lowest(content);
    return record.score >= num(settings, "placement.text_pass") ? after(content, textLevel) : textLevel;
  };
  const highestOpen = placementLevels(content).at(-1);
  return {
    pv,
    fv,
    fg,
    listening: skill("listening"),
    reading: skill("reading"),
    above: above ? (highestOpen === content.levels.at(-1) ? "path" : "content") : null,
    phonicsAuto: pv === null,
    texts: state.texts.filter((text) => text.score !== null).map((text) => ({ textId: text.textId, track: text.track })),
    blocks: state.blocks,
    stopped: state.stopped,
  };
}

// ───────────────────────────── the sample after placement (PRD §11.4) ─────────────────────────────

export type SampleResult = "open" | "passed" | "failed";

/** The 30 typed words of `P_v` (PRD §11.4): counts and the result; `notice` waits for the end of a session after a failure. */
export type VocabSample = { level: string; wordIds: number[]; ok: number; wrong: number; result: SampleResult; notice: boolean };

/** The ten G5b sentences of the level below `F_g`, in two rounds on `days` (PRD §11.4); no card, `review_log.kind = placement`. */
export type GrammarSample = { level: string; targetIds: number[]; days: string[]; answered: number[]; ok: number; wrong: number; result: SampleResult; notice: boolean };

/** `placement_run.sample_state`. */
export type SampleState = { vocab: VocabSample | null; grammar: GrammarSample | null };

/** The probation step of a word (PRD §9.7): 5, a recognize word 3, a colloquial one 2. */
export const wordProbationStep = (word: WordC) => (isColloquial(word) ? PROBATION_STEP.colloquial : word.mastery === "recognize" ? PROBATION_STEP.recognize : PROBATION_STEP.produce);

/** A word's probation card (PRD §9.7): its step, a virtual Easy review and the given due date. */
export function probationCard(word: WordC, kind: "single" | "sample", source: ItemStateE["source"], now: Date, due: Date | null, settings: Settings): ItemStateE {
  return probationState("word", word.id, wordProbationStep(word), kind, source, now, settings, due);
}

/** How many answers pass a sample of `size` and which wrong one fails it (PRD §11.4: 24 of 30 and the seventh wrong; 8 of 10 and the third). */
export function sampleMarks(settings: Settings, size: number): { need: number; failAt: number } {
  const need = Math.ceil(num(settings, "sample.pass_ratio") * size - 1e-9);
  return { need, failAt: size - need + 1 };
}

/**
 * The sample made at the end of the test (PRD §11.3, §11.4): typed words of `P_v` with their probation
 * cards, due a third today, a third tomorrow and a third the day after; and the grammar sentences of the
 * level below `F_g` when `F_g` is not the lowest level.
 */
export function makeSample(content: Content, settings: Settings, result: PlacementResult, seed: string, now: Date, today: string): { sample: SampleState; cards: ItemStateE[] } {
  const rng = seeded(seed, "sample");
  let vocab: VocabSample | null = null;
  const cards: ItemStateE[] = [];
  if (result.pv !== null) {
    const words = cardWordsOf(content, result.pv);
    const size = num(settings, "sample.words");
    const produce = shuffle(rng, words.filter((word) => word.mastery === "produce"));
    const recognize = shuffle(rng, words.filter((word) => word.mastery === "recognize"));
    const chosen = [...produce, ...recognize].slice(0, size);
    chosen.forEach((word, i) => {
      const day = Math.floor((i * PLACEMENT_RULE.sampleDays) / chosen.length);
      cards.push(probationCard(word, "sample", "placement", now, day === 0 ? now : tehranDayStart(addDays(today, day)), settings));
    });
    if (chosen.length > 0) vocab = { level: result.pv, wordIds: chosen.map((word) => word.id), ok: 0, wrong: 0, result: "open", notice: false };
  }
  let grammar: GrammarSample | null = null;
  if (levelIndex(content, result.fg) > 0) {
    const level = before(content, result.fg);
    const targetIds = spreadTargets(placementEnv(content, settings, rng, level), level, "G5b", num(settings, "sample.sentences"));
    if (targetIds.length > 0) {
      const days = Array.from({ length: PLACEMENT_RULE.grammarRounds }, (_, i) => addDays(today, i));
      grammar = { level, targetIds, days, answered: [], ok: 0, wrong: 0, result: "open", notice: false };
    }
  }
  return { sample: { vocab, grammar }, cards };
}

/** One answer of a vocabulary sample card (PRD §11.4): decided as soon as it is certain. */
export function sampleVocabAnswer(sample: VocabSample, ok: boolean, settings: Settings): VocabSample {
  if (sample.result !== "open") return sample;
  const next = { ...sample, ok: sample.ok + (ok ? 1 : 0), wrong: sample.wrong + (ok ? 0 : 1) };
  const { need, failAt } = sampleMarks(settings, sample.wordIds.length);
  if (next.ok >= need) return { ...next, result: "passed" };
  if (next.wrong >= failAt) return { ...next, result: "failed", notice: true };
  return next;
}

/** The grammar sample's rounds: the targets of each, in order. */
export function grammarRounds(sample: GrammarSample): number[][] {
  const size = Math.ceil(sample.targetIds.length / PLACEMENT_RULE.grammarRounds);
  return Array.from({ length: PLACEMENT_RULE.grammarRounds }, (_, i) => sample.targetIds.slice(i * size, (i + 1) * size)).filter((round) => round.length > 0);
}

/** Targets of the grammar sample due today (PRD §11.4, §10.2 step 4): round 1 from its day, round 2 once round 1 is done and its day came. */
export function grammarSampleDue(sample: GrammarSample | null | undefined, today: string): number[] {
  if (!sample || sample.result !== "open") return [];
  const answered = new Set(sample.answered);
  for (const [i, round] of grammarRounds(sample).entries()) {
    const left = round.filter((id) => !answered.has(id));
    if (left.length === 0) continue;
    return today >= (sample.days[i] ?? sample.days.at(-1)!) ? left : [];
  }
  return [];
}

/** One answer of the grammar sample (PRD §11.4): no typo allowance, decided as soon as it is certain. */
export function sampleGrammarAnswer(sample: GrammarSample, targetId: number, ok: boolean, settings: Settings): GrammarSample {
  if (sample.result !== "open" || sample.answered.includes(targetId)) return sample;
  const next = { ...sample, answered: [...sample.answered, targetId], ok: sample.ok + (ok ? 1 : 0), wrong: sample.wrong + (ok ? 0 : 1) };
  const { need, failAt } = sampleMarks(settings, sample.targetIds.length);
  if (next.ok >= need) return { ...next, result: "passed" };
  if (next.wrong >= failAt) return { ...next, result: "failed", notice: true };
  if (next.answered.length === sample.targetIds.length) return { ...next, result: next.ok >= need ? "passed" : "failed", notice: next.ok < need };
  return next;
}

/**
 * A failed sample (PRD §11.4): vocabulary goes back to `P_v` (level and `known_below`) and the sample
 * cards not asked yet go; grammar's units of the level below `F_g` are not known any more. Returns the
 * skill rows to write and the item keys to delete.
 */
export function afterSampleFail(kind: "vocab" | "grammar", level: string, skills: readonly SkillLevelE[], items: readonly ItemStateE[]): { skills: SkillLevelE[]; remove: string[] } {
  const skill: SkillName = kind === "vocab" ? "vocab" : "grammar";
  const next = skills.map((row) => (row.skill === skill ? { ...row, level, knownBelow: level } : row));
  const remove = kind === "vocab" ? items.filter((item) => item.itemType === "word" && item.probation === "sample").map((item) => itemKey("word", item.itemId)) : [];
  return { skills: next, remove };
}

/**
 * Forms of other words one letter away from `word` (PRD §5.6): lemmas, plurals and conjugated forms. A
 * typed answer that is one of them is wrong even in the sample.
 */
export function typoForms(content: Content, word: WordC): string[] {
  const target = word.lemma.toLowerCase();
  const out = new Set<string>();
  const check = (form: string | null | undefined) => {
    if (form && form.toLowerCase() !== target && oneLetterOff(form.toLowerCase(), target)) out.add(form);
  };
  for (const other of content.words.values()) {
    if (other.id === word.id) continue;
    check(other.lemma);
    check(other.plural);
  }
  for (const table of content.conjugations) for (const form of Object.values(table.forms)) check(form);
  return [...out];
}

/**
 * One answer that counts in the sample (PRD §11.4), with what a failure changes: the sample after it,
 * the skill rows and the sample cards to delete. The server and the in-memory learner both use it.
 */
export function applySampleAnswer(
  sample: SampleState,
  answer: { kind: "vocab"; wordId: number; ok: boolean } | { kind: "grammar"; targetId: number; ok: boolean },
  skills: readonly SkillLevelE[],
  items: readonly ItemStateE[],
  settings: Settings,
): { sample: SampleState; skills: SkillLevelE[] | null; remove: string[]; failed: "vocab" | "grammar" | null } {
  if (answer.kind === "vocab") {
    if (!sample.vocab || !sample.vocab.wordIds.includes(answer.wordId)) return { sample, skills: null, remove: [], failed: null };
    const vocab = sampleVocabAnswer(sample.vocab, answer.ok, settings);
    const next = { ...sample, vocab };
    if (sample.vocab.result === "open" && vocab.result === "failed") {
      // The card just answered is no longer on probation, so only the ones not asked yet go.
      const done = afterSampleFail("vocab", vocab.level, skills, items.filter((item) => !(item.itemType === "word" && item.itemId === answer.wordId)));
      return { sample: next, skills: done.skills, remove: done.remove, failed: "vocab" };
    }
    return { sample: next, skills: null, remove: [], failed: null };
  }
  if (!sample.grammar) return { sample, skills: null, remove: [], failed: null };
  const grammar = sampleGrammarAnswer(sample.grammar, answer.targetId, answer.ok, settings);
  const next = { ...sample, grammar };
  if (sample.grammar.result === "open" && grammar.result === "failed") {
    const done = afterSampleFail("grammar", grammar.level, skills, items);
    return { sample: next, skills: done.skills, remove: [], failed: "grammar" };
  }
  return { sample: next, skills: null, remove: [], failed: null };
}

/**
 * What the end of the test writes (PRD §11.3): the four skill rows, the sample cards and the sample. A
 * skill row's `known_below` is its level: words and units below it count as known.
 */
export function placementOutcome(content: Content, settings: Settings, result: PlacementResult, seed: string, now: Date, today: string): { skills: SkillLevelE[]; cards: ItemStateE[]; sample: SampleState } {
  const skills: SkillLevelE[] = [
    { skill: "vocab", level: result.fv, knownBelow: result.fv },
    { skill: "grammar", level: result.fg, knownBelow: result.fg },
    { skill: "listening", level: result.listening, knownBelow: result.listening },
    { skill: "reading", level: result.reading, knownBelow: result.reading },
  ];
  const { sample, cards } = makeSample(content, settings, result, seed, now, today);
  return { skills, cards, sample };
}

// ───────────────────────────── readiness, for the panel ─────────────────────────────

/** What the test can ask of one level, counted the way the test picks its questions. */
export type PlacementReadiness = {
  level: string;
  /** Open to learners (or approved, for a tester). Closed levels are not asked. */
  open: boolean;
  /** Card words with a meaning: the vocabulary block takes `block_size` of them. */
  words: number;
  /** G1a questions the grammar block would have (at most `block_size`). */
  grammar: number;
  /** G5b sentences the grammar sample of this level would have (at most `sample.sentences`). */
  sample: number;
  /** `placement_ok` texts with at least four set-A questions, per track. */
  texts: Record<Track, number>;
  blockSize: number;
  sampleSize: number;
};

export function placementReadiness(content: Content, settings: Settings): PlacementReadiness[] {
  const blockSize = num(settings, "placement.block_size");
  const sampleSize = num(settings, "sample.sentences");
  return content.levels.map((level) => {
    const env = placementEnv(content, settings, seeded("readiness", level), level);
    const texts = (track: Track) => content.texts.filter((text) => text.level === level && text.placementOk && text.questions[track].A.length >= PLACEMENT_RULE.textMinQuestions).length;
    return {
      level,
      open: content.openLevels.includes(level),
      words: cardWordsOf(content, level).filter((word) => word.meanings.length > 0).length,
      grammar: spreadTargets(env, level, "G1a", blockSize).length,
      sample: spreadTargets(env, level, "G5b", sampleSize).length,
      texts: { listening: texts("listening"), reading: texts("reading") },
      blockSize,
      sampleSize,
    };
  });
}
