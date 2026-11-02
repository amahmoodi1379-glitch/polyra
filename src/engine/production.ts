import { sentenceViewOf, type BuildEnv } from "./build";
import { levelIndex, type Content, type DialogueC, type ErrorfixC, type SentenceC, type Speak } from "./content";
import { spokenWords } from "./drill";
import type { SentenceView } from "./ex";
import type { ItemIndex } from "./levels";
import { shuffle } from "./random";
import { num, type Settings } from "./settings";
import type { DialogueStateE, ErrorfixResultE, ErrorfixStateE, ItemStateE, SkillLevelE, SpeakRating, SpeakStateE } from "./state";
import { cleanAnswer, hasWordChar, matchText, words, type Lang } from "./text";
import { addDays, tehranDate, tehranDayStart, weekStart } from "./time";

/**
 * Speaking and writing (PRD §8b): «بگو، بعد بشنو» (S1), situational dialogues (S3), find the
 * mistake (S4) and the weekly guided writing (S5). None of them moves a card, a step, the notebook or a
 * level: S1 and S5 are judged by the learner, S3 and S4 have two fixed attempts. Pure functions over the
 * visible content and the learner's rows.
 */

/** Numbers fixed by PRD §8b (DECISIONS.md: formula numbers are named, not settings). */
export const PRODUCTION = {
  /** S1 takes new sentences with a word introduced in the last seven days first (§8b.2). */
  recentDays: 7,
  /** A new dialogue needs `known.threshold` of its words known, or 80% when no dialogue reaches it (§8b.4). */
  dialogueFallback: 0.8,
  /** Dialogues and find-the-mistake texts have two attempts (§8b.4, §8b.5). */
  attempts: 2,
  /** The level from which S1 takes longer sentences and find the mistake and writing open (§8b.1, §8b.2). */
  highLevel: "B1",
  /** «تمام شد» on a writing task needs half its smallest word count (§8b.6). */
  finishShare: 0.5,
} as const;

export const speakKey = (sentenceId: number) => `s:${sentenceId}`;
export const dialogueKey = (dialogueId: number) => `d:${dialogueId}`;
export const errorfixKey = (itemId: number) => `e:${itemId}`;

/** Whether a level is B1 or higher in the language's level list; false when it has no B1. */
export function isHighLevel(content: Pick<Content, "levels">, level: string | null | undefined): boolean {
  const high = levelIndex(content, PRODUCTION.highLevel);
  return high >= 0 && levelIndex(content, level) >= high;
}

/** The start of the Tehran day `days` after `today`: a gap counted in calendar days, due all that day. */
const dayAfter = (today: string, days: number) => tehranDayStart(addDays(today, days)).toISOString();
const reached = (at: string | null, now: Date) => !at || Date.parse(at) <= now.getTime();

// ───────────────────────────── S1: «بگو، بعد بشنو» ─────────────────────────────

/** S1's gate (PRD §10.3): with sentence listening, `gate.drill_words` introduced card words, for every learner. Null when open. */
export function speakGate(introducedCardWords: number, settings: Settings): { need: number; left: number } | null {
  const need = num(settings, "gate.drill_words");
  return introducedCardWords < need ? { need, left: need - introducedCardWords } : null;
}

/** A sentence said `speak.done_after_ok` times right, or shown `speak.max_shows` times, does not come again (PRD §8b.2). */
export const speakDone = (state: Pick<SpeakStateE, "count" | "correctCount">, settings: Settings) =>
  state.correctCount >= num(settings, "speak.done_after_ok") || state.count >= num(settings, "speak.max_shows");

/** The longest sentence S1 gives: `speak.max_words_low` up to A2, `speak.max_words_high` from B1 (PRD §8b.2). */
export const speakMaxWords = (content: Pick<Content, "levels">, vocabLevel: string, settings: Settings) =>
  num(settings, isHighLevel(content, vocabLevel) ? "speak.max_words_high" : "speak.max_words_low");

/** A sentence S1 may give: of the bank or a dialogue (never a text), every word known, short enough. */
function speakable(env: BuildEnv, sentence: SentenceC, maxWords: number): boolean {
  if (sentence.inText) return false;
  for (const token of sentence.tokens) if (token.kind === "word" && (token.wordId === null || !env.known(token.wordId))) return false;
  return spokenWords(sentence) <= maxWords;
}

/**
 * S1's sentences in order (PRD §8b.2): those whose `next_at` passed, the oldest first; then new ones
 * with a word introduced in the last seven days; then the other new ones, at random.
 */
export function* speakOrder(env: BuildEnv, speaks: readonly SpeakStateE[], items: readonly ItemStateE[], now: Date): Generator<SentenceC> {
  const { content, settings } = env;
  const maxWords = speakMaxWords(content, env.vocabLevel, settings);
  const seen = new Set(speaks.map((state) => state.sentenceId));
  const due = speaks
    .filter((state) => !speakDone(state, settings) && reached(state.nextAt, now))
    .sort((a, b) => (a.nextAt ? Date.parse(a.nextAt) : 0) - (b.nextAt ? Date.parse(b.nextAt) : 0));
  for (const state of due) {
    const sentence = content.sentences.get(state.sentenceId);
    if (sentence && speakable(env, sentence, maxWords)) yield sentence;
  }
  const since = now.getTime() - PRODUCTION.recentDays * 86_400_000;
  const recent = new Set(items.filter((item) => item.itemType === "word" && item.introducedAt && Date.parse(item.introducedAt) >= since).map((item) => item.itemId));
  const fresh: SentenceC[] = [];
  const rest: SentenceC[] = [];
  for (const sentence of content.sentences.values()) {
    if (seen.has(sentence.id) || !speakable(env, sentence, maxWords)) continue;
    (sentence.tokens.some((token) => token.wordId !== null && recent.has(token.wordId)) ? fresh : rest).push(sentence);
  }
  yield* shuffle(env.rng, fresh);
  yield* shuffle(env.rng, rest);
}

/** The screen of one S1 sentence: its translation to say, then its text and sound. */
export type SpeakView = { sentence: SentenceView };
export const speakView = (content: Content, sentence: SentenceC): SpeakView => ({ sentence: sentenceViewOf(sentence, content, { translation: true }) });

/** One showing rated by the learner (PRD §8b.2): «بلد نبودم» 2 days, «تقریباً» 4, «درست گفتم» 10. */
export function afterSpeak(before: SpeakStateE | null, sentenceId: number, rating: SpeakRating, today: string, settings: Settings): SpeakStateE {
  const gap = num(settings, rating === "ok" ? "speak.gap_ok" : rating === "near" ? "speak.gap_near" : "speak.gap_no");
  return {
    sentenceId,
    count: (before?.count ?? 0) + 1,
    correctCount: (before?.correctCount ?? 0) + (rating === "ok" ? 1 : 0),
    lastRating: rating,
    nextAt: dayAfter(today, gap),
  };
}

export const SPEAK_RESULT = { ok: "self_ok", near: "self_near", no: "self_no" } as const;

// ───────────────────────────── S3: situational dialogue ─────────────────────────────

export type DialogueTurnView = { line: SentenceView; speaker: string | null; choices: SentenceView[]; correct: number; whyFa: string };
export type DialogueView = { id: number; title: string; situation: string; level: string; turns: DialogueTurnView[] };

/** A dialogue as its screen shows it; null when a sentence is missing from the content. */
export function dialogueView(content: Content, dialogue: DialogueC): DialogueView | null {
  const view = (id: number) => {
    const sentence = content.sentences.get(id);
    return sentence ? sentenceViewOf(sentence, content, { translation: true }) : null;
  };
  const turns: DialogueTurnView[] = [];
  for (const turn of dialogue.turns) {
    const line = view(turn.sentenceId);
    const choices = turn.choices.map(view);
    if (!line || choices.some((choice) => !choice) || turn.correct < 0 || turn.correct >= choices.length) return null;
    turns.push({ line, speaker: turn.speaker, choices: choices as SentenceView[], correct: turn.correct, whyFa: turn.whyFa });
  }
  return turns.length > 0 ? { id: dialogue.id, title: dialogue.titleFa, situation: dialogue.situationFa, level: dialogue.level, turns } : null;
}

const dialogueSentences = (dialogue: DialogueC) => dialogue.turns.flatMap((turn) => [turn.sentenceId, ...turn.choices]);

/** Share of known words over every line and choice of a dialogue (PRD §8b.4), repeats counted. */
export function dialogueKnownShare(content: Content, dialogue: DialogueC, known: (wordId: number) => boolean): number {
  let total = 0;
  let ok = 0;
  for (const id of dialogueSentences(dialogue)) {
    const sentence = content.sentences.get(id);
    if (!sentence) return 0;
    for (const token of sentence.tokens) {
      if (token.kind !== "word") continue;
      total++;
      if (token.wordId !== null && known(token.wordId)) ok++;
    }
  }
  return total === 0 ? 1 : ok / total;
}

export type DialoguePick = { dialogue: DialogueC; attempt: number; before: DialogueStateE | null };

/** The dialogue gate (PRD §8b.4, §10.3): `gate.dialogue_words` introduced card words, for every learner. Null when open. */
export function dialogueGate(introducedCardWords: number, settings: Settings): { need: number; left: number } | null {
  const need = num(settings, "gate.dialogue_words");
  return introducedCardWords < need ? { need, left: need - introducedCardWords } : null;
}

/**
 * The next dialogue (PRD §8b.4): a due attempt 2 first, the oldest first; else a new one of at most the
 * learner's vocabulary level with `known.threshold` of its words known (80% when none has), the lowest
 * level and then the oldest first. Null behind the gate or when none is allowed.
 */
export function nextDialogue(env: BuildEnv, states: readonly DialogueStateE[], introducedCardWords: number, now: Date): DialoguePick | null {
  const { content, settings } = env;
  if (dialogueGate(introducedCardWords, settings)) return null;
  const byId = new Map(content.dialogues.map((dialogue) => [dialogue.id, dialogue]));
  const due = states
    .filter((state) => state.attemptsDone > 0 && state.attemptsDone < PRODUCTION.attempts && reached(state.nextAttemptAt, now) && byId.has(state.dialogueId))
    .sort((a, b) => (a.nextAttemptAt ? Date.parse(a.nextAttemptAt) : 0) - (b.nextAttemptAt ? Date.parse(b.nextAttemptAt) : 0))[0];
  if (due) return { dialogue: byId.get(due.dialogueId)!, attempt: due.attemptsDone + 1, before: due };
  const tried = new Set(states.map((state) => state.dialogueId));
  const ceiling = levelIndex(content, env.vocabLevel);
  const fresh = content.dialogues
    .filter((dialogue) => !tried.has(dialogue.id) && levelIndex(content, dialogue.level) <= ceiling)
    .sort((a, b) => levelIndex(content, a.level) - levelIndex(content, b.level) || a.id - b.id)
    .map((dialogue) => ({ dialogue, share: dialogueKnownShare(content, dialogue, env.known) }));
  const pick = fresh.find((item) => item.share >= num(settings, "known.threshold")) ?? fresh.find((item) => item.share >= PRODUCTION.dialogueFallback);
  return pick ? { dialogue: pick.dialogue, attempt: 1, before: null } : null;
}

/** Whether each turn was right at the first choice (PRD §8b.4); a turn without a choice is wrong. */
export const gradeDialogue = (view: Pick<DialogueView, "turns">, firsts: readonly number[]): boolean[] => view.turns.map((turn, i) => firsts[i] === turn.correct);

/** `s`: the share of turns right at the first choice. */
export const dialogueScore = (right: readonly boolean[]) => (right.length === 0 ? 0 : right.filter(Boolean).length / right.length);

/** After an attempt: attempt 2 comes `dialogue.gap_days` days later; after it the dialogue is over (PRD §8b.4). */
export function afterDialogue(before: DialogueStateE | null, dialogueId: number, score: number, today: string, settings: Settings): DialogueStateE {
  const attemptsDone = (before?.attemptsDone ?? 0) + 1;
  return {
    dialogueId,
    attemptsDone,
    scores: [...(before?.scores ?? []), score],
    nextAttemptAt: attemptsDone < PRODUCTION.attempts ? dayAfter(today, num(settings, "dialogue.gap_days")) : null,
  };
}

/** Seconds a dialogue takes: `time.dialogue_turn` per turn. */
export const dialogueCost = (dialogue: Pick<DialogueC, "turns">, settings: Settings) => dialogue.turns.length * num(settings, "time.dialogue_turn");

// ───────────────────────────── S4: find the mistake ─────────────────────────────

const MARK = /\{\{([^{}|]*)\|([^{}|]*)\}\}/g;
/** Words as the screen splits them: letters with an elided apostrophe kept, or a number. */
const PIECE = /[\p{L}\p{M}]+['’]?|\p{Nd}+/gu;

/** One piece of the text as shown: a word the learner can tap (a mistake has `mark`), or what lies between words. */
export type ErrorfixPiece = { text: string; word: boolean; mark: number | null };
export type ErrorfixView = {
  id: number;
  level: string;
  pieces: ErrorfixPiece[];
  marks: { wrong: string; right: string; whyFa: string }[];
  corrected: string;
  translation: string;
  speak: Speak;
};

/** The marked text in pieces, each mistake one tappable word showing its wrong form (PRD §8b.5). */
export function errorfixPieces(marked: string): { pieces: ErrorfixPiece[]; marks: { wrong: string; right: string }[] } {
  const pieces: ErrorfixPiece[] = [];
  const marks: { wrong: string; right: string }[] = [];
  const plain = (text: string) => {
    let last = 0;
    for (const match of text.matchAll(PIECE)) {
      if (match.index > last) pieces.push({ text: text.slice(last, match.index), word: false, mark: null });
      pieces.push({ text: match[0], word: true, mark: null });
      last = match.index + match[0].length;
    }
    if (last < text.length) pieces.push({ text: text.slice(last), word: false, mark: null });
  };
  let last = 0;
  for (const match of marked.matchAll(MARK)) {
    plain(marked.slice(last, match.index));
    marks.push({ wrong: match[1].trim(), right: match[2].trim() });
    pieces.push({ text: match[1].trim(), word: true, mark: marks.length - 1 });
    last = match.index + match[0].length;
  }
  plain(marked.slice(last));
  return { pieces, marks };
}

export const correctedOf = (marked: string) => marked.replace(MARK, (_, __, right: string) => right.trim());

export function errorfixView(content: Content, item: ErrorfixC): ErrorfixView {
  const { pieces, marks } = errorfixPieces(item.markedText);
  const corrected = correctedOf(item.markedText);
  return {
    id: item.id,
    level: item.level,
    pieces,
    marks: marks.map((mark, k) => ({ ...mark, whyFa: item.whyFa[k] ?? "" })),
    corrected,
    translation: item.translationFa,
    speak: { text: corrected, lang: content.language, url: null },
  };
}

/** What each mistake became: fixed, fixed but for an accent or a capital («تقریباً درست»), changed wrongly, or left. */
export type MarkResult = "fixed" | "near" | "wrong" | "missed";
export type ErrorfixGraded = { marks: MarkResult[]; wrongTaps: number[]; result: ErrorfixResultE };

/**
 * Grades the learner's changes, piece index to the word typed (PRD §8b.5): a mistake is fixed when its
 * right form was typed (an accent or a capital is nearly right and counts); a right word changed is a
 * wrong tap. Right only when every mistake is fixed and no right word was changed.
 */
export function gradeErrorfix(view: Pick<ErrorfixView, "pieces" | "marks">, fixes: Readonly<Record<string, string>>, lang: Lang): ErrorfixGraded {
  const clean = (text: string) => cleanAnswer(text, false);
  const marks: MarkResult[] = view.marks.map(() => "missed");
  const wrongTaps: number[] = [];
  view.pieces.forEach((piece, index) => {
    const given = fixes[String(index)];
    if (given === undefined || clean(given) === "") return;
    if (piece.mark === null) {
      if (piece.word && clean(given).toLowerCase() !== clean(piece.text).toLowerCase()) wrongTaps.push(index);
      return;
    }
    const match = matchText(clean(given), clean(view.marks[piece.mark].right), lang, false);
    marks[piece.mark] = match.result === "correct" ? "fixed" : match.result === "near" ? "near" : "wrong";
  });
  const fixed = marks.filter((mark) => mark === "fixed" || mark === "near").length;
  return { marks, wrongTaps, result: { fixed, of: marks.length, wrongTaps: wrongTaps.length, ok: fixed === marks.length && wrongTaps.length === 0 } };
}

export type ErrorfixPick = { item: ErrorfixC; attempt: number; before: ErrorfixStateE | null };

/** The learner's grammar level for find the mistake: the higher of the skill row (placement) and the newest unit opened. */
function grammarAt(content: Content, items: ItemIndex, grammar: SkillLevelE | undefined): number {
  let level = levelIndex(content, grammar?.level ?? content.levels[0]);
  for (const unit of content.units) if (items.units.has(unit.id)) level = Math.max(level, levelIndex(content, unit.level));
  return level;
}

/**
 * Whether find the mistake is open (PRD §8b.5, §10.3): the grammar level is B1 or higher. `level` is
 * that grammar level, for the panel.
 */
export function errorfixOpen(content: Content, items: ItemIndex, grammar: SkillLevelE | undefined): { open: boolean; level: string } {
  const at = grammarAt(content, items, grammar);
  return { open: isHighLevel(content, content.levels[at]), level: content.levels[at] ?? content.levels[0] };
}

/**
 * The next find-the-mistake text (PRD §8b.5): a due attempt 2 first; else a new one of at most the
 * grammar level whose units are all opened (a unit below a placement's `known_below` counts) and with
 * `known.threshold` of its words known, the lowest level and then the oldest first.
 */
export function nextErrorfix(env: BuildEnv, states: readonly ErrorfixStateE[], items: ItemIndex, grammar: SkillLevelE | undefined, now: Date): ErrorfixPick | null {
  const { content, settings } = env;
  if (!errorfixOpen(content, items, grammar).open) return null;
  const byId = new Map(content.errorfixes.map((item) => [item.id, item]));
  const due = states
    .filter((state) => state.attemptsDone > 0 && state.attemptsDone < PRODUCTION.attempts && reached(state.nextAttemptAt, now) && byId.has(state.itemId))
    .sort((a, b) => (a.nextAttemptAt ? Date.parse(a.nextAttemptAt) : 0) - (b.nextAttemptAt ? Date.parse(b.nextAttemptAt) : 0))[0];
  if (due) return { item: byId.get(due.itemId)!, attempt: due.attemptsDone + 1, before: due };
  const ceiling = grammarAt(content, items, grammar);
  const below = grammar?.knownBelow ? levelIndex(content, grammar.knownBelow) : -1;
  const units = new Map(content.units.map((unit) => [unit.unitCode, unit]));
  const opened = (code: string) => {
    const unit = units.get(code);
    return !!unit && (items.units.has(unit.id) || levelIndex(content, unit.level) < below);
  };
  const tried = new Set(states.map((state) => state.itemId));
  const threshold = num(settings, "known.threshold");
  const item = content.errorfixes
    .filter((item) => !tried.has(item.id) && levelIndex(content, item.level) <= ceiling && item.unitCodes.every(opened))
    .sort((a, b) => levelIndex(content, a.level) - levelIndex(content, b.level) || a.id - b.id)
    .find((item) => (item.wordIds.length === 0 ? 1 : item.wordIds.filter((id) => env.known(id)).length / item.wordIds.length) >= threshold);
  return item ? { item, attempt: 1, before: null } : null;
}

/** After an attempt: attempt 2 comes `errorfix.gap_days` days later; after it the text is over (PRD §8b.5). */
export function afterErrorfix(before: ErrorfixStateE | null, itemId: number, result: ErrorfixResultE, today: string, settings: Settings): ErrorfixStateE {
  const attemptsDone = (before?.attemptsDone ?? 0) + 1;
  return {
    itemId,
    attemptsDone,
    results: [...(before?.results ?? []), result],
    nextAttemptAt: attemptsDone < PRODUCTION.attempts ? dayAfter(today, num(settings, "errorfix.gap_days")) : null,
  };
}

// ───────────────────────────── S5: weekly writing ─────────────────────────────

export type WritingTaskC = {
  id: number;
  level: string;
  promptFa: string;
  minWords: number;
  maxWords: number;
  checklist: string[];
  phrases: { text: string; translationFa: string }[];
  modelAnswer: string;
  modelAnswerFa: string;
};

/** Words of a piece of writing, as its counter shows them. */
export const writingWords = (text: string) => words(cleanAnswer(text, true)).filter(hasWordChar).length;

/** «تمام شد» comes alive at half the task's smallest word count (PRD §8b.6). */
export const writingMinToFinish = (task: Pick<WritingTaskC, "minWords">) => Math.ceil(task.minWords * PRODUCTION.finishShare);

export type WeeklyWriting =
  /** Vocabulary below B1, or writing switched off (`writing.per_week` 0). */
  | { state: "closed" }
  /** This week's writing is done. */
  | { state: "done" }
  /** Open, but every task of the level and below is written. */
  | { state: "none" }
  | { state: "open"; task: WritingTaskC };

/**
 * This week's writing card (PRD §8b.6): from vocabulary B1 on, `writing.per_week` tasks each week
 * (Saturday to Friday) until done, in the order of level and then publishing, never above the
 * learner's vocabulary level (DECISIONS.md).
 */
export function weeklyWriting(
  content: Pick<Content, "levels">,
  tasks: readonly WritingTaskC[],
  written: readonly { taskId: number; at: string }[],
  vocabLevel: string,
  today: string,
  settings: Settings,
): WeeklyWriting {
  const perWeek = num(settings, "writing.per_week");
  if (perWeek <= 0 || !isHighLevel(content, vocabLevel)) return { state: "closed" };
  const week = weekStart(today);
  if (written.filter((entry) => weekStart(tehranDate(new Date(entry.at))) === week).length >= perWeek) return { state: "done" };
  const done = new Set(written.map((entry) => entry.taskId));
  const ceiling = levelIndex(content, vocabLevel);
  const task = [...tasks]
    .filter((task) => !done.has(task.id) && levelIndex(content, task.level) >= 0 && levelIndex(content, task.level) <= ceiling)
    .sort((a, b) => levelIndex(content, a.level) - levelIndex(content, b.level) || a.id - b.id)[0];
  return task ? { state: "open", task } : { state: "none" };
}

/** Seconds of a writing session counted as active learning, at most `writing.max_minutes` (PRD §8b.6). */
export const writingActiveSec = (seconds: number, settings: Settings) => Math.max(0, Math.min(Math.round(seconds), num(settings, "writing.max_minutes") * 60));

