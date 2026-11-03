import { applyConfusion, applyRound, applySingle, leechPair, newItemState, probationState, type AnswerCtx, type RoundOutcome, type SingleOutcome } from "../answer";
import type { QuestionC, QuestionSetName, Track } from "../content";
import type { Ex, RawAnswer } from "../ex";
import { grade, type GradeOutcome, type Graded } from "../grade";
import type { NotebookOp } from "../notebook";
import { dictSource, gradeQuestion, stageScore, type GradedQuestion, type QuestionAnswer } from "../questions";
import { afterPhonicsRound, phonicsScore } from "../phonics";
import { afterDialogue, afterErrorfix, afterSpeak, dialogueScore, gradeDialogue, gradeErrorfix, SPEAK_RESULT, type ErrorfixGraded } from "../production";
import { num, type Settings } from "../settings";
import {
  isItemKey,
  parseItemKey,
  type ConfusionE,
  type DialogueStateE,
  type ErrorfixStateE,
  type ItemStateE,
  type PhonicsStateE,
  type SpeakRating,
  type SpeakStateE,
  type TextStage,
  type TextStateE,
} from "../state";
import { afterStage } from "../texts";
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
  kind: "intro" | "pretest" | "review" | "followup" | "practice" | "drill" | "placement" | "text_attempt" | "phonics" | "self" | "dialogue" | "errorfix";
  itemType: string | null;
  itemId: number | null;
  code: string | null;
  stepBefore: number | null;
  stepAfter: number | null;
  sentenceId: number | null;
  targetId: number | null;
  result: Graded["result"] | (typeof SPEAK_RESULT)[SpeakRating];
  reason: Graded["reason"];
  raw: string | null;
  chosenWordId: number | null;
  firstTyping: boolean;
  rating: number | null;
};

/** One stage of a text, graded (PRD §7.4): a row per question, and the text's state after it. */
export type TextOutcome = {
  textId: number;
  track: Track;
  attempt: number;
  stage: TextStage;
  set: QuestionSetName;
  questions: QuestionC[];
  graded: GradedQuestion[];
  score: number;
  /** `review_log.kind`: scored rounds are `text_attempt`; the round with help is only practice. */
  kind: "text_attempt" | "practice";
  state: TextStateE;
  /** Seconds added to today's new text time of the track (PRD §10.5): the whole attempt, after its first round. */
  newSec: number;
};

/**
 * A speaking card, judged (PRD §8b): its row to write. Nothing else of the learner changes: no card, no
 * step, no notebook, no level, no accuracy (§8b.1).
 */
export type ProductionOutcome =
  | { kind: "speak"; sentenceId: number; rating: SpeakRating; state: SpeakStateE }
  /** One row per turn in `review_log`, each with its line and whether the first choice was right. */
  | { kind: "dialogue"; dialogueId: number; attempt: number; turns: { sentenceId: number; right: boolean; choice: number | null }[]; score: number; state: DialogueStateE }
  | { kind: "errorfix"; itemId: number; attempt: number; graded: ErrorfixGraded; state: ErrorfixStateE };

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
      /** A drilled sentence: one more showing to write (PRD §7.6). */
      drill: number | null;
      /** A text stage (PRD §7.4). */
      text: TextOutcome | null;
      /** Key words shown before a text, for `new_word_queue` (PRD §7.5, source `key_word`). */
      keyWords: number[];
      /** A finished phonics round: the lesson's state to write (PRD §8.3). */
      phonics: { state: PhonicsStateE; score: number } | null;
      /** «بعداً» on an auto phonics round, counted toward `phonics.max_skips` (PRD §8.4). */
      phonicsLater: boolean;
      /** A speaking card (PRD §8b). */
      production?: ProductionOutcome | null;
      /** An answer that counts in the placement sample (PRD §11.4): a sample card's first review, or a grammar sample sentence. */
      sample?: SampleAnswer | null;
      /** «این را بلدم» pressed, or a «پیش‌آزمون» answered (PRD §11.5): for today's counts and the pretest mode. */
      known?: { kind: "iknow" | "pretest"; ok: boolean } | null;
      advanced: Advanced;
    };

export type SampleAnswer = { kind: "vocab"; wordId: number; ok: boolean } | { kind: "grammar"; targetId: number; ok: boolean };

const RATING = { again: 1, hard: 2, good: 3, easy: 4 } as const;

/**
 * The exercise the learner actually saw: the version without sound in a no-sound session, or when the
 * browser says it showed it (`alt`: «الان نمی‌توانم گوش بدهم» pressed mid-session, or no voice on the
 * device, PRD §10.12).
 */
export const shownEx = (plan: SessionPlan, card: Card, alt?: boolean): Ex | null => ((alt ?? plan.noAudio) && card.alt ? card.alt : (card.ex ?? null));

/**
 * Whether the browser shows a card's version without sound (PRD §10.12): sound is off for the whole
 * session or since «الان نمی‌توانم گوش بدهم», the device has no voice for the sound, or the sound was
 * not ready `audio.wait_sec` after the card appeared (T63). A card without such a version keeps its
 * play button, so the session never waits on a file.
 */
export function wantsAlt(plan: SessionPlan, card: Card, why: { muted: boolean; noVoice: boolean; waitedSec: number | null }, settings: Settings): boolean {
  if (!card.alt || !card.ex?.audio) return false;
  if (plan.noAudio || why.muted || why.noVoice) return true;
  return why.waitedSec !== null && why.waitedSec >= num(settings, "audio.wait_sec");
}

/**
 * Cards that cannot be played without sound (PRD §10.12): a sentence heard alone, a phonics round, «بگو، بعد بشنو» (§8b.1), and
 * every card of a listening text (its key words, its stages). «الان نمی‌توانم گوش بدهم» takes them out
 * of the session unscored; a text for reading stays.
 */
export function needsSound(plan: SessionPlan, card: Card): boolean {
  if (card.t === "drill" || card.t === "phonics" || card.t === "phonicsq" || card.t === "speak") return true;
  if (card.t === "text") return card.text?.track === "listening";
  if (card.t === "textwords") return plan.queue.some((other) => other.block === card.block && other.t === "text" && other.text?.track === "listening");
  return false;
}

/** Whether nothing but cards that need sound is left (PRD §10.12): a silent session is built instead (T92). */
export const onlySoundLeft = (plan: SessionPlan): boolean => plan.queue.length > 0 && plan.queue.every((card) => needsSound(plan, card));

export function playCard(plan: SessionPlan, cardId: string, answer: RawAnswer, timing: { latencyMs: number; elapsedSec: number; alt?: boolean }, env: PlayEnv): PlayResult {
  const card = plan.queue[0];
  if (!card || card.id !== cardId) throw new Error(`Card ${cardId} is not the next card`);
  const { ctx } = env;
  const ex = shownEx(plan, card, timing.alt);
  const key = card.item;
  const parsed = isItemKey(key) ? parseItemKey(key) : null;
  const base: PlayLog = {
    kind: "intro",
    itemType: parsed ? parsed.type : key.startsWith("t:") ? "grammar_target" : null,
    itemId: parsed ? parsed.id : key.startsWith("t:") ? Number(key.slice(2)) : null,
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

  // A sentence heard alone or a listening text left out without sound (PRD §10.12, T62): unscored, no
  // counter moves and nothing is written, so it stays due; a text's other stages and its key words go with it.
  if (card.t !== "phonics" && card.t !== "phonicsq" && "skip" in answer && answer.skip === "drop" && needsSound(plan, card)) {
    const advanced = advance(plan, { cardId, result: "seen", skip: "drop", elapsedSec: timing.elapsedSec }, ctx.settings);
    const textId = card.text?.textId ?? (card.t === "textwords" ? Number(key.slice(2)) : null);
    const log: PlayLog = { ...base, code: null, result: "idk", raw: "drop", ...(textId !== null ? { itemType: "text", itemId: textId } : {}) };
    return { done: true, card, ex: null, graded: null, log, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, drill: null, text: null, keyWords: [], phonics: null, phonicsLater: false, advanced };
  }

  // A text stage (PRD §7.4): every question graded; the first round sets `first_score`, the round with help is practice.
  if (card.t === "text" && card.text) {
    const info = card.text;
    const view = plan.texts[info.textId];
    const questions = view.questions[info.set];
    const given = "answers" in answer ? answer : { answers: {} as Record<string, QuestionAnswer>, timedOut: false };
    const graded = questions.map((question) =>
      gradeQuestion(question, given.answers[String(question.id)], {
        lang: env.language,
        sentence: question.type === "dict" && view.sentences[question.sentence] ? dictSource(view.sentences[question.sentence]) : undefined,
        timedOut: given.timedOut,
      }),
    );
    const score = stageScore(graded);
    const before = plan.textStates[key] ?? null;
    const state = afterStage(before, { text: { id: info.textId, band: view.band }, ...info, score, answers: given.answers }, ctx.now, ctx.settings);
    let advanced = advance(plan, { cardId, result: "seen", elapsedSec: timing.elapsedSec }, ctx.settings);
    advanced = { ...advanced, plan: { ...advanced.plan, textStates: { ...advanced.plan.textStates, [key]: state } } };
    const kind = info.stage === "help" ? "practice" : "text_attempt";
    const text: TextOutcome = { ...info, questions, graded, score, kind, state, newSec: info.stage === "first" ? Math.round(info.cost) : 0 };
    const log: PlayLog = { ...base, kind, itemType: "text", itemId: info.textId, code: null, result: "correct" };
    return { done: true, card, ex: null, graded: null, log, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, drill: null, text, keyWords: [], phonics: null, phonicsLater: false, advanced };
  }

  // The start of a phonics round (PRD §8.3, §8.4): seen, set aside with «بعداً», or left out without sound
  // (§10.12); without sound the rest of a round started goes too, unscored, and it comes again whole.
  if (card.t === "phonics" || (card.t === "phonicsq" && "skip" in answer)) {
    const skip = "skip" in answer ? answer.skip : null;
    const advanced = advance(plan, { cardId, result: "seen", skip, elapsedSec: timing.elapsedSec }, ctx.settings);
    const lessonId = plan.phonics?.lessonId ?? Number(key.slice(2));
    const log: PlayLog = { ...base, itemType: "phonics_lesson", itemId: lessonId, code: null, ...(skip ? { result: "idk", raw: skip } : {}) };
    const phonicsLater = card.t === "phonics" && skip === "later" && !!plan.phonics?.auto;
    return { done: true, card, ex: null, graded: null, log, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, drill: null, text: null, keyWords: [], phonics: null, phonicsLater, advanced };
  }

  // Speaking (PRD §8b): judged here, one row to write, no counter of the session moves (§8b.1).
  if (card.prod) {
    const { prod } = card;
    const advanced = advance(plan, { cardId, result: "seen", elapsedSec: timing.elapsedSec }, ctx.settings);
    const empty = { ex: null, graded: null, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, drill: null, text: null, keyWords: [], phonics: null, phonicsLater: false };
    if (prod.kind === "speak") {
      const rating: SpeakRating = "self" in answer && (answer.self === "ok" || answer.self === "near") ? answer.self : "no";
      const sentenceId = prod.view.sentence.id;
      const state = afterSpeak(prod.before, sentenceId, rating, ctx.today, ctx.settings);
      const log: PlayLog = { ...base, kind: "self", itemType: "sentence", itemId: sentenceId, code: "S1", sentenceId, result: SPEAK_RESULT[rating] };
      return { done: true, card, ...empty, log, production: { kind: "speak", sentenceId, rating, state }, advanced };
    }
    if (prod.kind === "dialogue") {
      const firsts = "turns" in answer && Array.isArray(answer.turns) ? answer.turns : [];
      const right = gradeDialogue(prod.view, firsts);
      const score = dialogueScore(right);
      const state = afterDialogue(prod.before, prod.view.id, score, ctx.today, ctx.settings);
      const turns = prod.view.turns.map((turn, i) => ({ sentenceId: turn.line.id, right: right[i], choice: typeof firsts[i] === "number" ? firsts[i] : null }));
      const log: PlayLog = { ...base, kind: "dialogue", itemType: "dialogue", itemId: prod.view.id, code: "S3", result: score === 1 ? "correct" : "wrong" };
      return { done: true, card, ...empty, log, production: { kind: "dialogue", dialogueId: prod.view.id, attempt: prod.attempt, turns, score, state }, advanced };
    }
    const fixes = "fixes" in answer && answer.fixes && typeof answer.fixes === "object" ? answer.fixes : {};
    const graded = gradeErrorfix(prod.view, fixes, env.language);
    const state = afterErrorfix(prod.before, prod.view.id, graded.result, ctx.today, ctx.settings);
    const log: PlayLog = { ...base, kind: "errorfix", itemType: "errorfix_item", itemId: prod.view.id, code: "S4", result: graded.result.ok ? "correct" : "wrong", raw: JSON.stringify(fixes) };
    return { done: true, card, ...empty, log, production: { kind: "errorfix", itemId: prod.view.id, attempt: prod.attempt, graded, state }, advanced };
  }

  // «این را بلدم» (PRD §11.5): a probation card instead of the item's first exercises, which leave the session.
  if ("iknow" in answer) {
    if ((card.t !== "intro" && card.t !== "lesson") || !card.probationStep || !parsed || (plan.counters.iknowLeft ?? 0) <= 0) throw new Error(`«این را بلدم» is not offered on card ${cardId}`);
    const state = probationState(parsed.type, parsed.id, card.probationStep, "single", "i_know", ctx.now, ctx.settings);
    const advanced = advance(plan, { cardId, result: "seen", known: "iknow", elapsedSec: timing.elapsedSec }, ctx.settings);
    const log: PlayLog = { ...base, code: null, raw: "iknow" };
    return { done: true, card, ex: null, graded: null, log, single: null, round: null, state, roundState: null, notebook: [], pair: null, drill: null, text: null, keyWords: [], phonics: null, phonicsLater: false, known: { kind: "iknow", ok: true }, advanced };
  }

  // Cards without a score (PRD §9.2, kind intro); «کلمه‌های این متن» sends its words to the queue (PRD §7.5).
  if (card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" || card.t === "textwords") {
    const advanced = advance(plan, { cardId, result: "seen", elapsedSec: timing.elapsedSec }, ctx.settings);
    const keyWords = card.t === "textwords" ? (card.words ?? []) : [];
    const log: PlayLog = { ...base, code: null, ...(card.t === "textwords" ? { itemType: "text", itemId: Number(key.slice(2)) } : {}) };
    return { done: true, card, ex: null, graded: null, log, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, drill: null, text: null, keyWords, phonics: null, phonicsLater: false, advanced };
  }
  if (!ex) throw new Error(`Card ${cardId} has no exercise`);

  const outcome = grade(ex, answer, { language: env.language, wordsWithLemma: env.wordsWithLemma });
  if (outcome.result === "synonym" || outcome.result === "persian") return { done: false, outcome };
  const graded = outcome;

  // «پیش‌آزمون» (PRD §11.5): right is a probation card and the rest of the block goes; wrong or «نمی‌دانم» costs nothing and the intro card comes.
  if (card.t === "pretest") {
    const ok = graded.result === "correct" || graded.result === "near";
    const state = ok && parsed && card.probationStep ? probationState(parsed.type, parsed.id, card.probationStep, "single", "pretest", ctx.now, ctx.settings) : null;
    const advanced = advance(plan, { cardId, result: "seen", known: ok ? "pretest" : null, elapsedSec: timing.elapsedSec }, ctx.settings);
    const log: PlayLog = { ...base, kind: "pretest", result: graded.result, reason: graded.reason, raw: graded.raw, chosenWordId: graded.chosenWordId };
    return { done: true, card, ex, graded, log, single: null, round: null, state, roundState: null, notebook: [], pair: null, drill: null, text: null, keyWords: [], phonics: null, phonicsLater: false, known: { kind: "pretest", ok }, advanced };
  }

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
      drill: null,
      text: null,
      keyWords: [],
      phonics: null,
      phonicsLater: false,
      advanced,
    };
  }

  // A phonics question (PRD §8.2): no card, no step, no notebook; the last one scores the round (§8.3).
  if (card.t === "phonicsq") {
    const advanced = advance(plan, { cardId, result: graded.result, elapsedSec: timing.elapsedSec }, ctx.settings);
    const round = advanced.plan.phonics;
    let phonics: { state: PhonicsStateE; score: number } | null = null;
    if (advanced.phonicsDone && round) {
      const score = phonicsScore(round.answers);
      phonics = { score, state: afterPhonicsRound(round.before, round.lessonId, round.round, score, ctx.now, ctx.settings) };
    }
    const log: PlayLog = { ...base, kind: "phonics", itemType: "phonics_lesson", itemId: round?.lessonId ?? Number(key.slice(2)), result: graded.result, reason: graded.reason, raw: graded.raw };
    return { done: true, card, ex, graded, log, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, drill: null, text: null, keyWords: [], phonics, phonicsLater: false, advanced };
  }

  // A sentence heard alone: no card, no step, no notebook, only one more showing (PRD §7.6).
  if (card.t === "drill") {
    const advanced = advance(plan, { cardId, result: graded.result, elapsedSec: timing.elapsedSec }, ctx.settings);
    const log: PlayLog = { ...base, kind: "drill", result: graded.result, reason: graded.reason, raw: graded.raw };
    return { done: true, card, ex, graded, log, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, drill: ex.sentenceId, text: null, keyWords: [], phonics: null, phonicsLater: false, advanced };
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
    // The last question of a scored round carries the round's rating and step change (PRD §9.10, «مرور نمره‌دار»).
    const scored = round?.scored
      ? { stepBefore: round.stepBefore, stepAfter: round.stepAfter, rating: round.rating ? RATING[round.rating] : null, firstTyping: round.firstTyping }
      : {};
    const log: PlayLog = { ...base, kind: "review", result: graded.result, reason: graded.reason, raw: graded.raw, stepBefore: plan.states[key]?.step ?? 1, ...scored };
    return { done: true, card, ex, graded, log, single: null, round, state: null, roundState, notebook, pair: null, drill: null, text: null, keyWords: [], phonics: null, phonicsLater: false, advanced };
  }

  // A grammar sample sentence (PRD §11.4): no card, no step, no notebook; only the sample's count.
  if (key.startsWith("g:")) {
    const targetId = Number(key.slice(2));
    const ok = graded.result === "correct" || graded.result === "near";
    const advanced = advance(plan, { cardId, result: graded.result, elapsedSec: timing.elapsedSec }, ctx.settings);
    const log: PlayLog = { ...base, kind: "placement", itemType: "grammar_target", itemId: targetId, result: graded.result, reason: graded.reason, raw: graded.raw };
    const sample: SampleAnswer = { kind: "grammar", targetId, ok };
    return { done: true, card, ex, graded, log, single: null, round: null, state: null, roundState: null, notebook: [], pair: null, drill: null, text: null, keyWords: [], phonics: null, phonicsLater: false, sample, advanced };
  }

  // A notebook sentence of a unit: one practice question (PRD §9.5).
  if (key.startsWith("t:")) {
    const failed = graded.result === "wrong" || graded.result === "idk";
    const notebook: NotebookOp[] = graded.result === "near" ? [] : [{ op: failed ? "restart" : "correct", refType: "grammar_target", refId: Number(key.slice(2)) }];
    const advanced = advance(plan, { cardId, result: graded.result, elapsedSec: timing.elapsedSec }, ctx.settings);
    const log: PlayLog = { ...base, kind: "practice", result: graded.result, reason: graded.reason, raw: graded.raw };
    return { done: true, card, ex, graded, log, single: null, round: null, state: null, roundState: null, notebook, pair: null, drill: null, text: null, keyWords: [], phonics: null, phonicsLater: false, advanced };
  }

  // A word or a conjugation card.
  const type = parsed!.type;
  const id = parsed!.id;
  const before = plan.states[key] ?? newItemState(type, id, ctx.now);
  const item = plan.items[key];
  const gender = ex.code === "W2d" || (ex.a.kind === "type" && !!ex.a.gender);
  const kind = card.kind ?? "review";
  // Only a practice can have no plan item (a unit or a table in «تمرین بیشتر»), and a practice moves no step.
  const applied = applySingle({ state: before, kind, code: ex.code, graded, latencyMs: timing.latencyMs, last: item?.last ?? before.step, gender }, ctx);
  // «تمرین بیشتر» changes nothing: no notebook, no extra practice (PRD §10.8).
  const extra = plan.scope === "extra";
  const single: SingleOutcome = extra ? { ...applied, notebook: [], practice: false, genderPractice: false } : applied;

  // Another word chosen by mistake, in any exercise but «تمرین بیشتر»: a confusion pair (PRD §9.9, DECISIONS.md).
  let pairs = plan.pairs;
  let pair: ConfusionE | null = null;
  let confusion: [number, number] | null = null;
  // Only pairs that existed when the session was built show their card (PRD §10.7).
  const atStart = new Set(plan.pairsAtStart);
  const knownAtStart = (a: number, b: number) => atStart.has(`${a}:${b}`);
  if (type === "word" && single.result === "wrong" && graded.chosenWordId && !extra) {
    const self = plan.words[id]?.word;
    const other = plan.words[graded.chosenWordId]?.word ?? { id: graded.chosenWordId, lemma: `#${graded.chosenWordId}` };
    if (self) {
      // A leech shows its own pair card instead (PRD §9.11), so this one is only counted.
      const result = applyConfusion(pairs, self, other, ctx, single.leech ? () => false : knownAtStart);
      pairs = result.pairs;
      pair = result.pair;
      if (result.showCard && result.pair) confusion = [result.pair.wordId, result.pair.otherWordId];
    }
  }
  let leechPartner: number | null = null;
  if (single.leech && type === "word") {
    const result = leechPair(pairs, id, ctx, knownAtStart);
    pairs = result.pairs;
    leechPartner = result.partner;
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
  // A sample card's first real review counts in the sample (PRD §11.4).
  const sample: SampleAnswer | null =
    type === "word" && kind === "review" && before.probation === "sample" ? { kind: "vocab", wordId: id, ok: single.result === "correct" || single.result === "near" } : null;
  // A practice moves neither FSRS nor the step: there is nothing to write.
  return { done: true, card, ex, graded, log, single, round: null, state: kind === "practice" ? null : single.state, roundState: null, notebook: single.notebook, pair, drill: null, text: null, keyWords: [], phonics: null, phonicsLater: false, sample, advanced };
}

/**
 * A session closed before its end (left, replaced or expired): each round left half-way is scored
 * when it has enough answers, and its wrong sentences go to the notebook even when it is not (PRD
 * §6.5 rule 8, §10.8). The server writes what comes back.
 */
export function closeRounds(plan: SessionPlan, ctx: AnswerCtx): RoundOutcome[] {
  return Object.entries(plan.rounds)
    .filter(([block, round]) => round.answers.length > 0 && plan.queue.some((card) => card.block === block))
    .map(([, round]) => applyRound(plan.states[round.item] ?? newItemState("grammar_unit", parseItemKey(round.item).id, ctx.now), round.step, round.answers, ctx, round.last));
}
