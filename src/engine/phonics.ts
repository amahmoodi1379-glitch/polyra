import { baseEx, type BuildEnv } from "./build";
import type { Content, PhonicsC, PhonicsKind, PhonicsSound, Speak } from "./content";
import type { Choice, Ex, HeardWord } from "./ex";
import { SHAPE } from "./exercises";
import type { Graded } from "./grade";
import { seeded, shuffle, type Rng } from "./random";
import { exerciseOn, num, type Settings } from "./settings";
import type { PhonicsStateE } from "./state";
import { addDays, tehranDate, tehranDayStart } from "./time";

/**
 * The alphabet and sounds module (PRD §8): which round comes next, its questions built from the
 * lesson's own fields (§8.2), and the lesson after a round (§8.3). A lesson has no FSRS card and never
 * goes to the notebook: round 1, then round 2 from the next day, repeated once the day after when it
 * scores below `phonics.retry_below`.
 */

export type PhonicsRound = { lesson: PhonicsC; round: 1 | 2; repeat: boolean };

/** A sentence of a liaison lesson as its screens show it: its words and the gaps a liaison is in. */
export type LiaisonView = { text: string; words: string[]; liaisonAfter: number[]; speak: Speak };

/** The start of a round (PRD §8.3): round 1 teaches (tip, example words or two sample sentences), round 2 reminds. */
export type PhonicsView = {
  lessonId: number;
  label: string;
  kind: PhonicsKind;
  graphemes: string[];
  tip: string;
  round: 1 | 2;
  repeat: boolean;
  /** Round 1 of a contrast or rule lesson: every example word, to hear. */
  words: HeardWord[];
  /** Round 1 of a liaison lesson: the two sample sentences. */
  samples: LiaisonView[];
  /** A contrast lesson's minimal pairs, shown only to read and hear again (never on the round's start). */
  pairs: { a: HeardWord; b: HeardWord }[];
  questions: number;
  /** «درس ۳ از ۱۴»: the lesson's place in the teacher's order. */
  index: number;
  total: number;
};

/** Plan key of a phonics lesson. */
export const phonicsKey = (lessonId: number) => `p:${lessonId}`;

const heard = (sound: PhonicsSound): HeardWord => ({ text: sound.text, meaning: sound.meaningFa, speak: sound.speak });
export const liaisonWords = (text: string) => text.trim().split(/\s+/);
const liaisonView = (sentence: PhonicsC["sentences"][number]): LiaisonView => ({
  text: sentence.text,
  words: liaisonWords(sentence.text),
  liaisonAfter: [...new Set(sentence.liaisonAfter)].sort((a, b) => a - b),
  speak: sentence.speak,
});

/** A lesson with every example word, sentence and pair: a round's start shows the words or two sentences, «الفبا و تلفظ» and «بازبینی» all. */
export const phonicsLessonView = (lesson: PhonicsC): Pick<PhonicsView, "lessonId" | "label" | "kind" | "graphemes" | "tip" | "words" | "samples" | "pairs"> => ({
  lessonId: lesson.id,
  label: lesson.label,
  kind: lesson.kind,
  graphemes: lesson.graphemes,
  tip: lesson.tipFa,
  words: lesson.words.map(heard),
  samples: lesson.sentences.map(liaisonView),
  pairs: lesson.pairs.map((pair) => ({ a: heard(pair.a), b: heard(pair.b) })),
});

const byLesson = (states: readonly PhonicsStateE[]) => new Map(states.map((state) => [state.lessonId, state]));

/** The codes of each round of a contrast lesson (PRD §8.3); either pair stands in for the other when the panel switched both of one off. */
const CONTRAST_CODES = { 1: ["P1", "P4"], 2: ["P2", "P3"] } as const;

/** The codes a round of this lesson asks, as the panel allows (PRD §9.8, `exercise.<code>.enabled`); none: the lesson cannot come. */
function roundCodes(kind: PhonicsKind, round: 1 | 2, settings: Settings): string[] {
  if (kind === "rule") return exerciseOn(settings, "P1") ? ["P1"] : [];
  if (kind === "liaison") return exerciseOn(settings, "P5") ? ["P5"] : [];
  const own = CONTRAST_CODES[round].filter((code) => exerciseOn(settings, code));
  return own.length > 0 ? own : CONTRAST_CODES[round === 1 ? 2 : 1].filter((code) => exerciseOn(settings, code));
}

/** Whether the panel leaves this lesson an exercise to ask; a lesson without one is passed over until one is on again. */
export const phonicsAskable = (lesson: Pick<PhonicsC, "kind">, settings: Settings) => roundCodes(lesson.kind, 1, settings).length > 0;

/**
 * The round that comes next (PRD §8.4): a round 2 whose day has come, the first in the teacher's
 * order; otherwise round 1 of the first lesson not started, so a lesson opens only after round 1 of
 * the one before it (§8.3) and a new order counts from the first lesson not done (§13.6). A lesson
 * whose every exercise the panel switched off is passed over until one is on again.
 */
export function nextPhonicsRound(content: Pick<Content, "phonics">, states: readonly PhonicsStateE[], now: Date, settings: Settings): PhonicsRound | null {
  const known = byLesson(states);
  const askable = content.phonics.filter((lesson) => phonicsAskable(lesson, settings));
  for (const lesson of askable) {
    const state = known.get(lesson.id);
    if (state && !state.done && state.roundsDone >= 1 && (!state.nextAt || Date.parse(state.nextAt) <= now.getTime())) {
      return { lesson, round: 2, repeat: state.roundsDone >= 2 };
    }
  }
  const fresh = askable.find((lesson) => (known.get(lesson.id)?.roundsDone ?? 0) === 0);
  return fresh ? { lesson: fresh, round: 1, repeat: false } : null;
}

/** «درس ۳ از ۱۴» (PRD §3.10): the lesson whose round 1 is next, and whether every lesson is over. */
export function phonicsProgress(content: Pick<Content, "phonics">, states: readonly PhonicsStateE[]): { index: number; total: number; done: boolean } {
  const known = byLesson(states);
  const total = content.phonics.length;
  const started = content.phonics.filter((lesson) => (known.get(lesson.id)?.roundsDone ?? 0) > 0).length;
  const done = total > 0 && content.phonics.every((lesson) => known.get(lesson.id)?.done);
  return { index: Math.min(total, started + 1), total, done };
}

/** A round's time, taken from the session's budget once (PRD §8.4, §10.1). */
export const phonicsRoundCost = (settings: Settings, round: 1 | 2) => num(settings, round === 1 ? "time.phonics_round1" : "time.phonics_round2");

/** The share of right answers; «نمی‌دانم» is not right (PRD §8.3). */
export const phonicsScore = (answers: readonly Graded["result"][]) =>
  answers.length === 0 ? 0 : answers.filter((result) => result === "correct" || result === "near").length / answers.length;

/**
 * The lesson after a finished round (PRD §8.3): the next round from the next Tehran day; after round 2
 * the lesson is over, unless it scored below `phonics.retry_below` the first time.
 */
export function afterPhonicsRound(before: PhonicsStateE | null, lessonId: number, round: 1 | 2, score: number, now: Date, settings: Settings): PhonicsStateE {
  const roundsDone = (before?.roundsDone ?? 0) + 1;
  const done = round === 2 && (roundsDone >= 3 || score >= num(settings, "phonics.retry_below"));
  return { lessonId, roundsDone, lastScore: score, nextAt: done ? null : tehranDayStart(addDays(tehranDate(now), 1)).toISOString(), done };
}

/**
 * «بعداً» on an auto round counts one more; any finished round starts the count again; the
 * `phonics.max_skips`th in a row turns the auto rounds off (PRD §8.4, T74).
 */
export function phonicsSkipsAfter(skips: number, event: "later" | "round", settings: Settings): { skips: number; off: boolean } {
  if (event === "round") return { skips: 0, off: false };
  const next = skips + 1;
  return { skips: next, off: next >= num(settings, "phonics.max_skips") };
}

/**
 * A lesson's example words or sentences in an order fixed for one learner, so round 2 knows which ones
 * round 1 asked without keeping them (PRD §8.3: round 2 asks the others).
 */
const fixedOrder = <T,>(userId: number, lesson: PhonicsC, list: readonly T[]): T[] => shuffle(seeded("phonics", userId, lesson.id), list);

/** `count` items: the fresh ones first, then the used ones again when the fresh run out (PRD §8.3, «اگر کم بود، تکرار»). */
function takeFresh<T>(rng: Rng, fresh: readonly T[], used: readonly T[], count: number): T[] {
  const out = shuffle(rng, fresh).slice(0, count);
  const again = shuffle(rng, used.length > 0 ? used : fresh);
  for (let i = 0; out.length < count && again.length > 0; i++) out.push(again[i % again.length]);
  return out;
}

/** `count` items taken in turn from a shuffled list, starting over when it runs out. */
function cycle<T>(rng: Rng, list: readonly T[], count: number): T[] {
  const order = shuffle(rng, list);
  return order.length === 0 ? [] : Array.from({ length: count }, (_, i) => order[i % order.length]);
}

/** Two kinds of question in turn: a, b, a, b… */
const alternate = (first: Ex[], second: Ex[]) => first.flatMap((ex, i) => (second[i] ? [ex, second[i]] : [ex])).concat(second.slice(first.length));

type Make = (code: string, fields: Partial<Ex> & Pick<Ex, "q" | "a">) => Ex;

function options(rng: Rng, correct: Omit<Choice, "id">, wrong: Omit<Choice, "id">[]): { options: Choice[]; correct: string } {
  const order = shuffle(rng, [0, ...wrong.map((_, i) => i + 1)]);
  const all = [correct, ...wrong];
  return { options: order.map((at, i) => ({ ...all[at], id: `o${i}` })), correct: `o${order.indexOf(0)}` };
}

/** P1: hear a word, choose its spelling from three: the right one and its two wrong spellings (PRD §8.2); the word plays again with the feedback. */
function p1(make: Make, rng: Rng, word: PhonicsC["words"][number]): Ex {
  const set = options(
    rng,
    { text: word.text, lang: "target" },
    word.wrong.slice(0, 2).map((text) => ({ text, lang: "target" as const })),
  );
  return make("P1", { listen: word.speak, after: word.speak, q: { heard: heard(word) }, a: { kind: "choice", ...set } });
}

/** P2: two sounds, the same or not: `a` twice, or `a` and `b` of one pair in either order (PRD §8.2). */
function p2(make: Make, rng: Rng, pair: PhonicsC["pairs"][number], same: boolean): Ex {
  const sounds = same ? [pair.a, pair.a] : shuffle(rng, [pair.a, pair.b]);
  const choices: Choice[] = [
    { id: "same", text: "same", lang: "fa" },
    { id: "different", text: "different", lang: "fa" },
  ];
  return make("P2", { q: { sounds: sounds.map(heard) }, a: { kind: "choice", options: choices, correct: same ? "same" : "different" } });
}

/** P3: three sounds, `a` of two pairs and `b` of one of them; the different one is `b` and plays again with the feedback (PRD §8.2). */
function p3(make: Make, rng: Rng, first: PhonicsC["pairs"][number], second: PhonicsC["pairs"][number]): Ex {
  const odd = rng() < 0.5 ? first.b : second.b;
  const sound = (item: PhonicsSound) => ({ text: item.text, lang: "target" as const, speak: item.speak });
  const set = options(rng, sound(odd), [sound(first.a), sound(second.a)]);
  return make("P3", { after: odd.speak, q: {}, a: { kind: "choice", ...set } });
}

/** P4: a written `a`, choose its sound from `a`, `b` of its pair and `b` of another pair (PRD §8.2); the right sound plays with the feedback. */
function p4(make: Make, rng: Rng, pair: PhonicsC["pairs"][number], other: PhonicsC["pairs"][number]): Ex {
  const sound = (item: PhonicsSound) => ({ text: item.text, lang: "target" as const, speak: item.speak });
  const set = options(rng, sound(pair.a), [sound(pair.b), sound(other.b)]);
  return make("P4", { after: pair.a.speak, q: { heard: heard(pair.a) }, a: { kind: "choice", ...set } });
}

/** P5: a written sentence; mark every place a liaison is in, and only those (PRD §8.2). Its sound plays with the feedback. */
function p5(make: Make, sentence: PhonicsC["sentences"][number]): Ex {
  const view = liaisonView(sentence);
  return make("P5", { after: sentence.speak, q: {}, a: { kind: "liaison", words: view.words, correct: view.liaisonAfter } });
}

/**
 * One round of a lesson (PRD §8.3), or null when the lesson cannot make it (too few words, pairs or
 * sentences, which the publish checks keep from happening, or every code switched off in the panel):
 * - contrast: round 1 asks P1 and P4 in turn, round 2 P2 and P3 in turn, three of each; a code switched
 *   off leaves the round to the other, and a round with both off asks the other round's codes;
 * - rule: six P1, round 2 with the words round 1 did not ask, then again some it did;
 * - liaison: four P5; round 1 shows two sample sentences first, round 2 asks the others.
 */
export function buildPhonicsRound(
  env: BuildEnv,
  pick: PhonicsRound,
  userId: number,
  where: { index: number; total: number },
): { questions: Ex[]; view: PhonicsView } | null {
  const { lesson, round } = pick;
  const { rng, settings } = env;
  const key = phonicsKey(lesson.id);
  const count = lesson.kind === "liaison" ? SHAPE.phonicsLiaisonQuestions : SHAPE.phonicsQuestions;
  const time = phonicsRoundCost(settings, round) / count;
  const make: Make = (code, fields) => ({ ...baseEx(env, code, key, fields.q, fields.a), step: round, time, ...fields });
  const half = Math.ceil(count / 2);
  let questions: Ex[] = [];
  let samples: LiaisonView[] = [];

  const codes = roundCodes(lesson.kind, round, settings);
  if (codes.length === 0) return null;
  if (lesson.kind === "contrast") {
    if (lesson.pairs.length < 2 || (codes.includes("P1") && lesson.words.length === 0)) return null;
    const asked = (code: string, n: number): Ex[] => {
      if (code === "P1") return cycle(rng, lesson.words, n).map((word) => p1(make, rng, word));
      if (code === "P4") {
        return cycle(rng, lesson.pairs, n).map((pair) => {
          const others = lesson.pairs.filter((other) => other !== pair && other.b.text !== pair.b.text && other.b.text !== pair.a.text);
          return p4(make, rng, pair, others.length > 0 ? others[Math.floor(rng() * others.length)] : lesson.pairs.find((other) => other !== pair)!);
        });
      }
      if (code === "P2") {
        // Half the same sound twice, half the two of a pair (PRD §8.2); an odd one either way.
        const extra = rng() < 0.5 ? 0 : 1;
        const same = shuffle(rng, Array.from({ length: n }, (_, i) => i % 2 === extra));
        return cycle(rng, lesson.pairs, n).map((pair, i) => p2(make, rng, pair, same[i]));
      }
      const order = shuffle(rng, lesson.pairs);
      return Array.from({ length: n }, (_, i) => p3(make, rng, order[i % order.length], order[(i + 1) % order.length]));
    };
    questions = codes.length === 2 ? alternate(asked(codes[0], half), asked(codes[1], count - half)) : asked(codes[0], count);
  } else if (lesson.kind === "rule") {
    if (lesson.words.length === 0) return null;
    const order = fixedOrder(userId, lesson, lesson.words);
    const first = order.slice(0, count);
    const words = round === 1 ? takeFresh(rng, first, [], count) : takeFresh(rng, order.slice(count), first, count);
    questions = words.map((word) => p1(make, rng, word));
  } else {
    const order = fixedOrder(userId, lesson, lesson.sentences);
    if (order.length < SHAPE.phonicsSamples + 1) return null;
    const sampled = order.slice(0, SHAPE.phonicsSamples);
    const first = order.slice(SHAPE.phonicsSamples, SHAPE.phonicsSamples + count);
    const rest = order.slice(SHAPE.phonicsSamples + count);
    const sentences = round === 1 ? takeFresh(rng, first, [], count) : takeFresh(rng, rest, [...sampled, ...first], count);
    questions = sentences.map((sentence) => p5(make, sentence));
    if (round === 1) samples = sampled.map(liaisonView);
  }

  const view: PhonicsView = {
    ...phonicsLessonView(lesson),
    round,
    repeat: pick.repeat,
    words: round === 1 ? lesson.words.map(heard) : [],
    samples,
    pairs: [],
    questions: questions.length,
    ...where,
  };
  return { questions, view };
}
