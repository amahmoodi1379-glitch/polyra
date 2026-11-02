import { randomUUID } from "node:crypto";
import type { RawAnswer } from "@/engine/ex";
import { seeded } from "@/engine/random";
import { buildSession } from "@/engine/session/build";
import { playCard, shownEx } from "@/engine/session/play";
import type { Card, SessionPlan } from "@/engine/session/types";
import { parseItemKey } from "@/engine/state";
import { tehranDate } from "@/engine/time";
import { TRACKS, type Track } from "@/engine/content";
import { makeEnv } from "@/engine/session/views";
import { introducedCardWords } from "@/engine/session/newmaterial";
import { indexItems } from "@/engine/levels";
import { correctedOf, dialogueGate, errorfixOpen, nextDialogue, nextErrorfix, PRODUCTION, speakDone, speakGate, speakOrder } from "@/engine/production";
import { indexTextStates, newText, nextAttempt, otherTrack, TEXT_RULE, textProgress, textStateKey, textWaiting, wasBorrowed, type TextEnv } from "@/engine/texts";
import { num } from "@/engine/settings";
import { scenarioById, type Scenario } from "@/lib/rehearse";
import { human } from "@/sim/human";
import type { LanguageCode } from "@/server/content/languages";
import { db } from "@/server/db";
import { submitAnswer } from "./answer";
import { resetProgress, startFromZero } from "./enroll";
import { learnContext, previewSession, startSession, type Bundle, type Learner } from "./session";
import { writingCard, writingTasks, type WritingCard } from "./writing";

/**
 * «آزمایش مثل زبان‌آموز» (DECISIONS.md, 2 November 2026): a teacher or a tester turns their own account
 * in one language into a made-up learner of a scenario, then opens the app and sees what the engine
 * shows that learner today. Only the caller's own progress in that language changes; no other account
 * is read or written.
 *
 * The account starts again from zero and every day of the scenario is played in the past, the last
 * one yesterday: each session goes through the same `startSession` and `submitAnswer` the app uses,
 * with the simulator's learner answering (PRD §16.3), so the rows are the ones a real learner leaves.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A session never has more cards than this; a guard against a plan that does not end. */
const MAX_CARDS = 400;

export type RehearseResult = { days: number; sessions: number; answers: number };

export async function rehearse(
  user: Learner & { phone: string | null },
  language: LanguageCode,
  scenarioId: string,
  now = new Date(),
  onDay?: (day: number) => void,
): Promise<RehearseResult> {
  if (!user.is_tester && !user.is_admin) throw new Error("Only a teacher or a tester can play a scenario");
  const scenario = scenarioById(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario ${scenarioId}`);

  const start = new Date(now.getTime() - scenario.days * DAY_MS);
  await resetProgress(user, language);
  await startFromZero(user, language, start);
  await db.enrollment.update({ where: { user_id_language: { user_id: user.id, language } }, data: { created_at: start } });

  const ctx = await learnContext(user, language, now);
  const seed = `${user.id}:${scenario.id}:${now.toISOString()}`;
  const person = human({ content: ctx.content, settings: ctx.settings, seed, ability: () => scenario.ability });
  const rng = seeded(seed, "answers");
  let sessions = 0;
  let answers = 0;
  for (let day = 0; day < scenario.days; day++) {
    onDay?.(day);
    for (let k = 0; k < scenario.sessions(day); k++) {
      // The sessions of a day an hour apart, at the time of day the teacher pressed the button.
      const at = new Date(start.getTime() + day * DAY_MS + k * HOUR_MS);
      const played = await playOne(user, language, scenario, at, person.policy, rng);
      if (played === null) continue;
      sessions++;
      answers += played;
    }
  }
  return { days: scenario.days, sessions, answers };
}

type Policy = ReturnType<typeof human>["policy"];

/** One «شروع» on `at`, every card answered by the made-up learner; the answers sent, or null when no session was built. */
async function playOne(user: Learner, language: LanguageCode, scenario: Scenario, at: Date, policy: Policy, rng: () => number): Promise<number | null> {
  const request = { language, scope: "mixed" as const, noAudio: false, cap: null };
  let result = await startSession(user, request, at);
  if (result.kind === "ask_word_cap") result = await startSession(user, { ...request, cap: scenario.cap }, at);
  if (result.kind === "ask_text_session") result = await startSession(user, { ...request, text: "confirmed" }, at);
  if (result.kind !== "session") return null;
  const bundle = result.bundle;
  const lexicon = new Map(bundle.lexicon);
  let plan = bundle.plan;
  let seq = bundle.nextSeq;
  let elapsedSec = 0;
  let sent = 0;
  for (let index = 0; plan.queue.length > 0 && index < MAX_CARDS; index++) {
    const card = plan.queue[0];
    const when = new Date(at.getTime() + elapsedSec * 1000);
    const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" || card.t === "textwords" || card.t === "text" ? null : shownEx(plan, card, false);
    const chosen = policy(card, ex, rng, { plan, at: when });
    elapsedSec += chosen.latencyMs / 1000;
    const answeredAt = new Date(at.getTime() + elapsedSec * 1000);
    const env = { ctx: { settings: bundle.settings, now: answeredAt, today: tehranDate(answeredAt), latency: plan.latency }, language, wordsWithLemma: (lemma: string) => lexicon.get(lemma) ?? [] };
    const timing = { latencyMs: chosen.latencyMs, elapsedSec, alt: false };
    let answer: RawAnswer = chosen.answer;
    let played = playCard(plan, card.id, answer, timing, env);
    if (!played.done) {
      answer = { idk: true };
      played = playCard(plan, card.id, answer, timing, env);
    }
    if (!played.done) break;
    const response = await submitAnswer(user, answerRequest(bundle, seq, card, answer, chosen.latencyMs, elapsedSec, answeredAt), answeredAt);
    if (response.kind !== "ok") break;
    sent++;
    seq++;
    plan = played.advanced.plan;
    if (response.finished) break;
  }
  return sent;
}

const answerRequest = (bundle: Bundle, seq: number, card: Card, answer: RawAnswer, latencyMs: number, elapsedSec: number, at: Date) => ({
  sessionId: bundle.id,
  answerId: randomUUID(),
  seq,
  cardId: card.id,
  answer: answer as Record<string, unknown>,
  latencyMs: Math.round(latencyMs),
  elapsedSec: Math.min(86_400, elapsedSec),
  at: at.toISOString(),
  shown: null,
  alt: false,
});

/** One line of «جلسه بعد چه دارد»: what kind of card, and which word, lesson or text. */
export type NextLine = { kind: NextKind; name: string; count: number };
export type NextKind = "newWord" | "word" | "newUnit" | "unit" | "conj" | "notebook" | "text" | "drill" | "phonics" | "confusion" | "speak" | "dialogue" | "errorfix";

/**
 * What the next «شروع» would bring today, item by item in the order it comes (built the same way the
 * start line is, nothing written). Null when the account has not started the language.
 */
export async function nextSession(user: Learner, language: LanguageCode, now = new Date()): Promise<{ minutes: number; empty: boolean; lines: NextLine[] } | null> {
  const preview = await previewSession(user, language, now);
  if (!preview) return null;
  const { ctx, learner } = preview;
  const options = { scope: "mixed" as const, lengthMin: learner.sessionLength, noAudio: false, cap: "none" as const, text: "confirmed" as const, seed: "preview" };
  const built = buildSession(ctx.content, learner, ctx.settings, now, ctx.today, options);
  if (built.kind !== "plan") return { minutes: learner.sessionLength, empty: true, lines: [] };
  return { minutes: learner.sessionLength, empty: false, lines: describe(built.plan, ctx.content) };
}

function describe(plan: SessionPlan, content: Awaited<ReturnType<typeof learnContext>>["content"]): NextLine[] {
  const lines: NextLine[] = [];
  const seen = new Map<string, NextLine>();
  const push = (key: string, kind: NextKind, name: string) => {
    const found = seen.get(key);
    if (found) {
      found.count++;
      return;
    }
    const line = { kind, name, count: 1 };
    seen.set(key, line);
    lines.push(line);
  };
  for (const card of plan.queue) {
    const [prefix, rawId] = card.item.split(":");
    const id = Number(rawId);
    if (card.t === "phonics" || card.t === "phonicsq") {
      push(card.item, "phonics", content.phonics.find((lesson) => lesson.id === id)?.label ?? "");
    } else if (card.t === "text" || card.t === "textwords") {
      const textId = card.text?.textId ?? id;
      push(`x:${textId}`, "text", content.texts.find((text) => text.id === textId)?.title ?? "");
    } else if (card.prod) {
      const prod = card.prod;
      push(card.item, prod.kind, prod.kind === "speak" ? prod.view.sentence.text : prod.kind === "dialogue" ? prod.view.title : shortText(prod.view.corrected));
    } else if (card.t === "drill") {
      push(card.item, "drill", content.sentences.get(id)?.text ?? "");
    } else if (card.t === "confusion") {
      push(`k:${card.item}`, "confusion", (card.pair ?? []).map((wordId) => content.words.get(wordId)?.lemma ?? "").join(" / "));
    } else if (card.note || card.item.startsWith("t:")) {
      push(`n:${card.item}`, "notebook", nameOf(card.item, content));
    } else if (prefix === "w") {
      const isNew = plan.items[card.item]?.isNew ?? card.t === "intro";
      push(card.item, isNew ? "newWord" : "word", nameOf(card.item, content));
    } else if (prefix === "u") {
      push(card.item, plan.states[card.item] ? "unit" : "newUnit", nameOf(card.item, content));
    } else if (prefix === "c") {
      push(card.item, "conj", nameOf(card.item, content));
    }
  }
  return lines;
}

function nameOf(key: string, content: Awaited<ReturnType<typeof learnContext>>["content"]): string {
  if (key.startsWith("t:")) {
    const target = content.targets.get(Number(key.slice(2)));
    const unit = target ? content.units.find((item) => item.id === target.targetId) : undefined;
    return unit?.titleFa ?? "";
  }
  const { type, id } = parseItemKey(key);
  if (type === "word") return content.words.get(id)?.lemma ?? "";
  if (type === "grammar_unit") return content.units.find((unit) => unit.id === id)?.titleFa ?? "";
  if (type === "conjugation") {
    const table = content.conjugations.find((item) => item.id === id);
    return table ? `${content.words.get(table.wordId)?.lemma ?? ""} (${table.tense})` : "";
  }
  return "";
}

/** One track's texts as the engine sees them today (PRD §7.5, §9.6), for «آزمایش مثل زبان‌آموز». */
export type TrackOverview = {
  track: Track;
  level: string;
  /** First rounds done on texts of the level, and how many the level asks for (rule 1 of §7.5). */
  firstRounds: number;
  need: number;
  /** `track_score`; null below three first rounds. */
  score: number | null;
  /** What this track's own button would bring first. */
  waiting: "resume" | "due" | "new" | null;
  /** The text a new attempt 1 would take now, if any. */
  nextNew: string | null;
};
export type TextLine = {
  title: string;
  track: Track;
  attemptsDone: number;
  attempts: number;
  firstScore: number | null;
  /** When the next attempt comes; null after the last one. */
  nextAt: string | null;
  /** A stage left half-way and still open. */
  partial: "first" | "help" | "again" | null;
  borrowed: boolean;
};

/**
 * The account's texts (PRD §7.4, §7.5), for a teacher trying a learner: each track's level, bar and
 * score, what comes next, and every text with its attempts. Nothing is written. Null before the
 * language is started.
 */
export async function textsOverview(user: Learner, language: LanguageCode, now = new Date()): Promise<{ tracks: TrackOverview[]; texts: TextLine[]; available: number } | null> {
  const preview = await previewSession(user, language, now);
  if (!preview) return null;
  const { learner, ctx } = preview;
  const { content, settings } = ctx;
  const env = makeEnv(content, learner, settings, seeded("try", user.id));
  const levelOf = (track: Track) => learner.skills.find((skill) => skill.skill === track)?.level ?? content.levels[0];
  const tenv: TextEnv = { content, settings, now, known: env.known, states: indexTextStates(learner.texts), levelOf };
  const tracks = TRACKS.map((track): TrackOverview => {
    const bar = textProgress(content, tenv.states, track, levelOf(track), settings);
    const pick = newText(tenv, track, new Set());
    return {
      track,
      level: bar.level,
      firstRounds: bar.firstRounds,
      need: Math.min(num(settings, "text.levelup_min"), bar.total),
      score: bar.score,
      waiting: textWaiting(tenv, track, learner.today.newTextSec[track]),
      nextNew: pick?.text.title ?? null,
    };
  });
  const texts = learner.texts
    .filter((state) => state.scores.length > 0 || state.attemptsDone > 0 || state.partial)
    .flatMap((state): TextLine[] => {
      const text = content.texts.find((item) => item.id === state.textId);
      if (!text) return [];
      const open = state.partial && state.partialUntil && Date.parse(state.partialUntil) > now.getTime() ? state.partial.stage : null;
      const next = nextAttempt(text, state);
      const takenOver = wasBorrowed(tenv.states.get(textStateKey(text.id, otherTrack(state.track))));
      return [
        {
          title: text.title,
          track: state.track,
          attemptsDone: state.attemptsDone,
          attempts: text.band === 1 ? TEXT_RULE.band1Attempts : TEXT_RULE.attempts,
          firstScore: state.firstScore,
          nextAt: next && state.attemptsDone > 0 && !takenOver ? state.nextAttemptAt : null,
          partial: open,
          borrowed: wasBorrowed(state),
        },
      ];
    })
    .sort((a, b) => a.track.localeCompare(b.track) || a.title.localeCompare(b.title));
  return { tracks, texts, available: content.texts.length };
}

const shortText = (text: string, max = 48) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Speaking and writing as the engine sees them today (PRD §8b), for «آزمایش مثل زبان‌آموز». Nothing is written. */
export type ProductionOverview = {
  /** Card words introduced so far: the gates of S1 and dialogues count them (PRD §10.3). */
  words: number;
  speak: { gate: { need: number; left: number } | null; seen: number; finished: number; ready: number };
  dialogue: {
    gate: { need: number; left: number } | null;
    next: { id: number; title: string; attempt: number } | null;
    tried: { id: number; title: string; attemptsDone: number; scores: number[]; nextAt: string | null }[];
    available: number;
  };
  errorfix: {
    open: boolean;
    /** The grammar level find the mistake goes by, and the level it opens at. */
    level: string;
    from: string;
    next: { id: number; name: string; attempt: number } | null;
    tried: { id: number; name: string; attemptsDone: number; ok: boolean[]; nextAt: string | null }[];
    available: number;
  };
  writing: { card: WritingCard; tasks: { id: number; level: string; promptFa: string }[] };
};

/** How many S1 sentences are counted as ready, at most. */
const SPEAK_COUNT_CAP = 999;

export async function productionOverview(user: Learner, language: LanguageCode, now = new Date()): Promise<ProductionOverview | null> {
  const preview = await previewSession(user, language, now);
  if (!preview) return null;
  const { learner, ctx } = preview;
  const { content, settings } = ctx;
  const env = makeEnv(content, learner, settings, seeded("try", user.id));
  const items = indexItems(learner.items);
  const words = introducedCardWords(content, learner.items);
  const grammar = learner.skills.find((skill) => skill.skill === "grammar");

  const sGate = speakGate(words, settings);
  let ready = 0;
  if (!sGate) {
    const order = speakOrder(env, learner.speaks, learner.items, now);
    while (ready < SPEAK_COUNT_CAP && !order.next().done) ready++;
  }

  const dialogues = new Map(content.dialogues.map((dialogue) => [dialogue.id, dialogue]));
  const dPick = nextDialogue(env, learner.dialogues, words, now);
  const errorfixes = new Map(content.errorfixes.map((item) => [item.id, item]));
  const ePick = nextErrorfix(env, learner.errorfixes, items, grammar, now);
  const eOpen = errorfixOpen(content, items, grammar);
  const [card, tasks] = await Promise.all([writingCard(user, language, now), writingTasks(language, ctx.audience)]);

  return {
    words,
    speak: { gate: sGate, seen: learner.speaks.length, finished: learner.speaks.filter((state) => speakDone(state, settings)).length, ready },
    dialogue: {
      gate: dialogueGate(words, settings),
      next: dPick ? { id: dPick.dialogue.id, title: dPick.dialogue.titleFa, attempt: dPick.attempt } : null,
      tried: learner.dialogues.flatMap((state) => {
        const dialogue = dialogues.get(state.dialogueId);
        return dialogue ? [{ id: dialogue.id, title: dialogue.titleFa, attemptsDone: state.attemptsDone, scores: state.scores, nextAt: state.nextAttemptAt }] : [];
      }),
      available: content.dialogues.length,
    },
    errorfix: {
      open: eOpen.open,
      level: eOpen.level,
      from: PRODUCTION.highLevel,
      next: ePick ? { id: ePick.item.id, name: shortText(correctedOf(ePick.item.markedText)), attempt: ePick.attempt } : null,
      tried: learner.errorfixes.flatMap((state) => {
        const item = errorfixes.get(state.itemId);
        return item ? [{ id: item.id, name: shortText(correctedOf(item.markedText)), attemptsDone: state.attemptsDone, ok: state.results.map((result) => result.ok), nextAt: state.nextAttemptAt }] : [];
      }),
      available: content.errorfixes.length,
    },
    writing: {
      card,
      tasks: [...tasks].sort((a, b) => content.levels.indexOf(a.level) - content.levels.indexOf(b.level) || a.id - b.id).map((task) => ({ id: task.id, level: task.level, promptFa: task.promptFa })),
    },
  };
}
