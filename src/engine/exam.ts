import { buildGrammarEx, buildWordEx } from "./build";
import { hasCard, isColloquial, levelIndex, type Content, type Track, type WordC } from "./content";
import type { Ex } from "./ex";
import { grammarLevel, indexItems } from "./levels";
import { placementEnv, typoForms } from "./placement";
import { seeded, shuffle } from "./random";
import { num, type Settings } from "./settings";
import type { ItemStateE, SkillLevelE, SkillName, TextStateE } from "./state";
import { stageRules, type StageRules } from "./texts";
import { addDays, tehranDate } from "./time";

/**
 * «پرش از این سطح» (PRD §11.6): a test of one skill at its current level. Vocabulary asks typed W5a of
 * produce card words not known yet (recognize words with W3b when short) with the one-letter allowance;
 * grammar asks G5b of the level's unopened units, evenly spaced, with no allowance; a track gives two
 * texts nobody touched under their last attempt's conditions. Answers change no card. A pass moves the
 * skill to the next level; a fail waits `exam.cooldown_days` for that skill and level.
 */

export const EXAM_RULE = {
  /** Texts in a listening or reading exam. */
  texts: 2,
  /** The attempt whose conditions a text is asked under: the last one (PRD §7.4: 3; band 1: 2). */
  lastAttempt: 3,
  band1LastAttempt: 2,
} as const;

/** What the skill sheet shows instead of or on the button (PRD §3.3, §11.6). */
export type ExamOffer =
  /** The last level of the path: nothing to skip to. */
  | { kind: "top" }
  /** The next level is not published yet: «سطح بعد به‌زودی» or the language's own line. */
  | { kind: "soon"; next: string }
  /** Too little of the level left for a test: no button. */
  | { kind: "few"; level: string }
  /** Failed lately: the date the next try opens on the button. */
  | { kind: "wait"; level: string; next: string; until: string }
  | { kind: "ready"; level: string; next: string };

export type ExamItem = { kind: "word"; id: number; code: "W5a" | "W3b" } | { kind: "target"; id: number } | { kind: "text"; id: number; track: Track };

export type ExamAsk =
  | { kind: "question"; number: number; size: number; ex: Ex }
  | { kind: "text"; number: number; size: number; textId: number; track: Track; attempt: number; set: "A" | "B"; rules: StageRules };

/** One text's result: its share of right answers and how many questions it had. */
export type ExamTextScore = { textId: number; score: number; questions: number };

export type ExamState = {
  version: 1;
  seed: string;
  skill: SkillName;
  level: string;
  next: string;
  items: ExamItem[];
  /** Items asked so far. */
  asked: number;
  right: number;
  texts: ExamTextScore[];
  /** The question on screen, kept so its answer is graded against what was shown. */
  current: ExamAsk | null;
};

export type ExamResult = { passed: boolean; score: number; size: number };

/** The learner as an exam needs them: levels, item states and texts touched. */
export type ExamLearner = { skills: SkillLevelE[]; items: ItemStateE[]; texts: TextStateE[] };

const isTrack = (skill: SkillName): skill is Track => skill === "listening" || skill === "reading";

/** The level a skill's exam is about: the skill's level, grammar's as the home shows it. */
export function examLevel(content: Content, learner: ExamLearner, skill: SkillName): string {
  const row = learner.skills.find((item) => item.skill === skill);
  if (skill === "grammar") return grammarLevel(content, indexItems(learner.items), row?.knownBelow ?? null);
  return row?.level ?? content.levels[0];
}

/** Card words of the level the learner has no card of yet: produce words first, then recognize ones (PRD §11.6). */
function unknownWords(content: Content, learner: ExamLearner, level: string): { produce: WordC[]; recognize: WordC[] } {
  const known = new Set(learner.items.filter((item) => item.itemType === "word").map((item) => item.itemId));
  const words = [...content.words.values()].filter((word) => word.level === level && hasCard(word) && !isColloquial(word) && !known.has(word.id) && word.meanings.length > 0);
  return { produce: words.filter((word) => word.mastery !== "recognize"), recognize: words.filter((word) => word.mastery === "recognize") };
}

const unopenedUnits = (content: Content, learner: ExamLearner, level: string) => {
  const opened = new Set(learner.items.filter((item) => item.itemType === "grammar_unit").map((item) => item.itemId));
  return content.units.filter((unit) => unit.level === level && !opened.has(unit.id));
};

/** The attempt and question set a text is asked with: its last attempt (PRD §11.6). */
const examAttempt = (band: number) => {
  const attempt = band === 1 ? EXAM_RULE.band1LastAttempt : EXAM_RULE.lastAttempt;
  return { attempt, set: (attempt === 2 ? "B" : "A") as "A" | "B" };
};

/** Texts of the level no track has touched (no attempt, not used in a test), with questions for the exam's set. */
function untouchedTexts(content: Content, learner: ExamLearner, level: string, track: Track) {
  const touched = new Set(learner.texts.map((state) => state.textId));
  return content.texts.filter((text) => text.level === level && !touched.has(text.id) && text.questions[track][examAttempt(text.band).set].length > 0);
}

/** Whether a level has anything of the skill to learn: a tester sees every level open, also an empty one (PRD §13.5). */
export function levelHasContent(content: Content, skill: SkillName, level: string): boolean {
  if (skill === "vocab") return [...content.words.values()].some((word) => word.level === level && hasCard(word));
  if (skill === "grammar") return content.units.some((unit) => unit.level === level);
  return content.texts.some((text) => text.level === level);
}

/** How many items the exam of a skill could ask: the button is hidden below its size (PRD §11.6). */
export function examRoom(content: Content, learner: ExamLearner, skill: SkillName, level: string): number {
  if (skill === "vocab") {
    const words = unknownWords(content, learner, level);
    return words.produce.length + words.recognize.length;
  }
  if (skill === "grammar") return unopenedUnits(content, learner, level).length;
  return untouchedTexts(content, learner, level, skill).length;
}

/**
 * The button on the skill sheet (PRD §3.3, §11.6). `lastFail`: when this skill's last exam at this level
 * was failed, if it was.
 */
export function examOffer(content: Content, learner: ExamLearner, skill: SkillName, settings: Settings, lastFail: Date | null, now: Date): ExamOffer {
  const level = examLevel(content, learner, skill);
  const index = levelIndex(content, level);
  if (index >= content.levels.length - 1) return { kind: "top" };
  const next = content.levels[index + 1];
  if (!content.openLevels.includes(next) || !levelHasContent(content, skill, next)) return { kind: "soon", next };
  const need = isTrack(skill) ? EXAM_RULE.texts : num(settings, "exam.size");
  if (examRoom(content, learner, skill, level) < need) return { kind: "few", level };
  if (lastFail) {
    const until = addDays(tehranDate(lastFail), num(settings, "exam.cooldown_days"));
    if (tehranDate(now) < until) return { kind: "wait", level, next, until };
  }
  return { kind: "ready", level, next };
}

/** Picks the exam's items for a skill at its level (PRD §11.6); null when the exam is not on offer. */
export function startExam(content: Content, learner: ExamLearner, skill: SkillName, settings: Settings, seed: string, lastFail: Date | null, now: Date): ExamState | null {
  const offer = examOffer(content, learner, skill, settings, lastFail, now);
  if (offer.kind !== "ready") return null;
  const { level, next } = offer;
  const rng = seeded(seed, "exam", skill, level);
  const size = num(settings, "exam.size");
  const env = placementEnv(content, settings, rng, level);
  let items: ExamItem[] = [];
  if (skill === "vocab") {
    // Random produce words that make a W5a, then recognize words with W3b while short.
    const words = unknownWords(content, learner, level);
    for (const word of shuffle(rng, words.produce)) if (items.length < size && buildWordEx(env, word, "W5a")) items.push({ kind: "word", id: word.id, code: "W5a" });
    for (const word of shuffle(rng, words.recognize)) if (items.length < size && buildWordEx(env, word, "W3b")) items.push({ kind: "word", id: word.id, code: "W3b" });
  } else if (skill === "grammar") {
    // Evenly spaced through the level's unopened units, one G5b sentence each.
    const units = unopenedUnits(content, learner, level)
      .map((unit) => ({ unit, targets: shuffle(rng, content.unitTargets.get(unit.id) ?? []).filter((target) => target.blanks === 1 && buildGrammarEx(env, unit, "G5b", { target })) }))
      .filter((entry) => entry.targets.length > 0);
    for (let i = 0; i < Math.min(size, units.length); i++) items.push({ kind: "target", id: units[Math.floor((i * units.length) / Math.min(size, units.length))].targets[0].id });
  } else {
    items = shuffle(rng, untouchedTexts(content, learner, level, skill))
      .slice(0, EXAM_RULE.texts)
      .map((text) => ({ kind: "text" as const, id: text.id, track: skill }));
  }
  const need = isTrack(skill) ? EXAM_RULE.texts : size;
  if (items.length < need) return null;
  return { version: 1, seed, skill, level, next, items, asked: 0, right: 0, texts: [], current: null };
}

/** The right answers that pass: `exam.pass_min` of `exam.size`, scaled if the exam is shorter. */
export function examPassMark(settings: Settings, size: number): number {
  const full = num(settings, "exam.size");
  const pass = num(settings, "exam.pass_min");
  return size >= full ? pass : Math.max(1, Math.ceil((pass * size) / full));
}

/** Whether the exam is over: every item asked, or its result can no longer change (DECISIONS.md, 3 November 2026). */
export function examOver(settings: Settings, state: ExamState): boolean {
  if (state.asked >= state.items.length) return true;
  if (isTrack(state.skill)) return false;
  const need = examPassMark(settings, state.items.length);
  return state.right >= need || state.asked - state.right > state.items.length - need;
}

/** The next question or text, or null when the exam is over. The question on screen stays until answered. */
export function examNext(content: Content, settings: Settings, state: ExamState): { state: ExamState; ask: ExamAsk | null } {
  if (state.current) return { state, ask: state.current };
  for (let at = state.asked; at < state.items.length && !examOver(settings, { ...state, asked: at }); at++) {
    const item = state.items[at];
    const ask = askOf(content, settings, state, item, at);
    // An item taken out of the content since the start is passed over and counts as asked.
    if (!ask) {
      state = { ...state, asked: at + 1 };
      continue;
    }
    const next = { ...state, asked: at, current: ask };
    return { state: next, ask };
  }
  return { state: { ...state, current: null }, ask: null };
}

function askOf(content: Content, settings: Settings, state: ExamState, item: ExamItem, at: number): ExamAsk | null {
  const size = state.items.length;
  const env = placementEnv(content, settings, seeded(state.seed, "ask", at), state.level);
  if (item.kind === "text") {
    const text = content.texts.find((one) => one.id === item.id);
    if (!text) return null;
    const { attempt, set } = examAttempt(text.band);
    return { kind: "text", number: at + 1, size, textId: text.id, track: item.track, attempt, set, rules: stageRules(text, item.track, attempt, "again") };
  }
  if (item.kind === "word") {
    const word = content.words.get(item.id);
    const ex = word ? buildWordEx(env, word, item.code) : null;
    if (!word || !ex) return null;
    // The one-letter allowance of a typed word (PRD §5.6).
    const typed = ex.a.kind === "type" ? { ...ex, a: { ...ex.a, typo: typoForms(content, word) } } : ex;
    return { kind: "question", number: at + 1, size, ex: noHelp({ ...typed, idk: true }) };
  }
  const target = content.targets.get(item.id);
  const unit = target ? content.units.find((one) => one.id === target.targetId) : undefined;
  const ex = target && unit ? buildGrammarEx(env, unit, "G5b", { target }) : null;
  return ex ? { kind: "question", number: at + 1, size, ex: noHelp({ ...ex, idk: true }) } : null;
}

/** No word to touch in an exam (PRD §11.6); G5b keeps the Persian sentence it asks for (§6.3). */
const noHelp = (ex: Ex): Ex => (ex.q.sentence ? { ...ex, q: { ...ex.q, sentence: { ...ex.q.sentence, glosses: [] } } } : ex);

/** One answer: a question's result («نمی‌دانم» is wrong), or a text's score. */
export function examAnswer(state: ExamState, input: { result: "correct" | "near" | "wrong" | "idk" } | ExamTextScore): ExamState {
  if (!state.current) return state;
  const base = { ...state, asked: state.asked + 1, current: null };
  if ("result" in input) return { ...base, right: base.right + (input.result === "correct" || input.result === "near" ? 1 : 0) };
  return { ...base, texts: [...state.texts, input] };
}

/** The result once over: right answers of the questions, or the texts' overall share as a percent (`level_exam.score`). */
export function examResult(settings: Settings, state: ExamState): ExamResult {
  if (isTrack(state.skill)) {
    const questions = state.texts.reduce((sum, text) => sum + text.questions, 0);
    const right = state.texts.reduce((sum, text) => sum + text.score * text.questions, 0);
    const share = questions === 0 ? 0 : right / questions;
    return { passed: questions > 0 && share >= num(settings, "exam.text_pass") - 1e-9, score: Math.round(share * 100), size: 100 };
  }
  return { passed: state.right >= examPassMark(settings, state.items.length), score: state.right, size: state.items.length };
}

/** The skill rows after a pass (PRD §11.6); a fail changes nothing. */
export function examSkills(skills: SkillLevelE[], state: ExamState, result: ExamResult): SkillLevelE[] {
  if (!result.passed) return skills;
  return skills.map((row) => {
    if (row.skill !== state.skill) return row;
    // Vocabulary and grammar: everything below the next level counts as known; a track only moves its level.
    return isTrack(state.skill) ? { ...row, level: state.next } : { ...row, level: state.next, knownBelow: state.next };
  });
}
