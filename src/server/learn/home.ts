import { hasCard, levelIndex } from "@/engine/content";
import { drillCounts, drillGate } from "@/engine/drill";
import { grammarLevel, grammarProgress, indexItems, overallLevel, vocabProgress } from "@/engine/levels";
import { openEntries } from "@/engine/notebook";
import { phonicsProgress } from "@/engine/phonics";
import { seeded } from "@/engine/random";
import { activeCards, isDue, noteCard } from "@/engine/session/build";
import { introducedCardWords } from "@/engine/session/newmaterial";
import { makeEnv } from "@/engine/session/views";
import { num } from "@/engine/settings";
import type { SkillName } from "@/engine/state";
import type { Track } from "@/engine/content";
import { dueTexts, indexTextStates, nextAttempt, stageDone, textLevelUp, textProgress, textWaiting, trackStarted, type TextEnv } from "@/engine/texts";
import { catchUp, doneToday } from "@/engine/streak";
import { addDays } from "@/engine/time";
import type { LanguageCode } from "@/server/content/languages";
import { db } from "@/server/db";
import { canPractice } from "./access";
import { asDate, dateOnly } from "./learner";
import { openSession, previewSession, type Learner } from "./session";

/**
 * What the home screen of a language shows (PRD §3.2): the overall level, the streak, the start
 * button's line, the quick button, the four skills and the small links.
 */

export type SkillTile = {
  skill: SkillName;
  level: string;
  progress: number;
  /** Why it is grey (PRD §10.3): words still needed, or no sentence or text the learner can follow yet. */
  lock: { kind: "words"; need: number; left: number } | { kind: "more" } | null;
  station: number;
  stations: number;
  introduced: number;
  stable: number;
  due: number;
  /** «یک متن منتظر توست» (PRD §10.4): what the skill's own session brings first. */
  text: "resume" | "due" | "new" | null;
  /**
   * Texts of the track: started (a first round) and with every attempt done (PRD §7.4). `wordsFor`: the
   * track is ready for the next level, which waits for the vocabulary to reach it (DECISIONS.md).
   */
  texts: { started: number; finished: number; wordsFor: string | null } | null;
};

export type HomeData = {
  language: LanguageCode;
  overall: string;
  streak: { count: number; today: boolean; freezes: number };
  /** `resumeText`: «ادامه متن» on the start line (PRD §3.2). */
  start: { minutes: number; reviews: number; newItems: number; empty: boolean; resume: boolean; resumeText: boolean };
  quick: boolean;
  /** «تمرین بیشتر روی کلمه‌های امروز», offered when the day is done (PRD §10.8). */
  extra: boolean;
  plan: PlanLine;
  locked: boolean;
  skills: SkillTile[];
  /** «الفبا و تلفظ» (PRD §3.2): «درس ۳ از ۱۴», while the language has phonics lessons. */
  links: { notebook: number; words: number; lessons: number; texts: number; phonics: { index: number; total: number; done: boolean } | null };
};

/** The quiet button at the top (PRD §3.8). Payment comes in a later phase, so it only reports. */
export type PlanLine = { kind: "tester" } | { kind: "trialNotStarted" } | { kind: "trial"; hours: number } | { kind: "subscription"; days: number } | { kind: "none" };

async function planLine(user: Learner, enrollment: { language: string; trial_started_at: Date | null; trial_ends_at: Date | null }, now: Date): Promise<PlanLine> {
  if (user.is_admin || user.is_tester) return { kind: "tester" };
  const subscription = await db.subscription.findFirst({
    where: { user_id: user.id, language: enrollment.language, ends_at: { gt: now } },
    orderBy: { ends_at: "desc" },
    select: { ends_at: true },
  });
  if (subscription) return { kind: "subscription", days: Math.ceil((subscription.ends_at.getTime() - now.getTime()) / 86_400_000) };
  if (!enrollment.trial_started_at) return { kind: "trialNotStarted" };
  if (enrollment.trial_ends_at && now < enrollment.trial_ends_at) return { kind: "trial", hours: Math.ceil((enrollment.trial_ends_at.getTime() - now.getTime()) / 3_600_000) };
  return { kind: "none" };
}

export async function homeData(user: Learner, language: LanguageCode, now = new Date()): Promise<HomeData | null> {
  const enrollment = await db.enrollment.findUnique({ where: { user_id_language: { user_id: user.id, language } } });
  if (!enrollment) return null;
  const preview = await previewSession(user, language, now);
  if (!preview) return null;
  const { learner, ctx } = preview;
  const { content, settings, today } = ctx;
  const items = indexItems(learner.items);

  // The streak as it stands today: missed days already covered or broken, nothing written (PRD §3.9).
  const days = await db.dailyCounter.findMany({
    where: { user_id: user.id, language, date_tehran: { gte: asDate(addDays(today, -60)) } },
    select: { date_tehran: true, active_sec: true },
  });
  const active = new Map(days.map((day) => [dateOnly(day.date_tehran)!, day.active_sec]));
  const streak = catchUp(learner.enrollment, today, (date) => active.get(date) ?? 0, settings).state;

  const vocabSkill = learner.skills.find((skill) => skill.skill === "vocab")!;
  const vocab = vocabProgress(content, items, vocabSkill, settings);
  const live = activeCards(content);
  const dueOf = (type: string) => learner.items.filter((item) => item.itemType === type && isDue(item, now, today) && live(item)).length;
  const fromStart = levelIndex(content, vocabSkill.knownBelow) <= 0;
  const introduced = introducedCardWords(content, learner.items);
  const gate = num(settings, "gate.grammar_words");
  const grammarOpen = !fromStart || introduced >= gate;
  const gLevel = grammarLevel(content, items);
  const grammar = grammarProgress(content, items, gLevel, settings);
  // Sentence listening (PRD §7.6): open after its word gate while a suitable sentence makes an exercise.
  const drillWait = drillGate(fromStart, introduced, settings);
  const env = makeEnv(content, learner, settings, seeded("home", user.id));
  const drills = drillCounts(env, learner.drills, now);
  const listening = learner.skills.find((skill) => skill.skill === "listening")!;
  const reading = learner.skills.find((skill) => skill.skill === "reading")!;

  // Texts (PRD §7.5, §9.6, §10.3): a track opens with its first allowed text and stays open once started.
  const tenv: TextEnv = { content, settings, now, known: env.known, states: indexTextStates(learner.texts), levelOf: (track) => (track === "listening" ? listening : reading).level };
  const textTile = (track: Track) => {
    const level = tenv.levelOf(track);
    const bar = textProgress(content, tenv.states, track, level, settings);
    const waiting = textWaiting(tenv, track, learner.today.newTextSec[track]);
    const due = dueTexts(tenv, [track]).length;
    const mine = learner.texts.filter((state) => state.track === track && state.scores.length > 0);
    const finished = mine.filter((state) => {
      const text = content.texts.find((item) => item.id === state.textId);
      return !!text && nextAttempt(text, state) === null;
    }).length;
    const ready = textLevelUp(content, tenv.states, track, level, settings, now, content.levels[content.levels.length - 1]);
    const wordsFor = ready && levelIndex(content, ready) > levelIndex(content, vocabSkill.level) ? ready : null;
    return { bar, waiting, due, texts: { started: mine.length, finished, wordsFor }, open: trackStarted(tenv.states, track) || waiting !== null };
  };
  const heard = textTile("listening");
  const read = textTile("reading");
  const listeningOpen = drills.playable || heard.open;

  const skills: SkillTile[] = [
    {
      skill: "vocab",
      level: vocab.level,
      progress: vocab.progress,
      lock: null,
      station: vocab.station,
      stations: vocab.stations,
      introduced: vocab.introduced,
      stable: vocab.stable,
      due: dueOf("word"),
      text: null,
      texts: null,
    },
    {
      skill: "grammar",
      level: gLevel,
      progress: grammarOpen ? grammar.progress : 0,
      lock: grammarOpen ? null : { kind: "words", need: gate, left: gate - introduced },
      station: grammar.station,
      stations: grammar.stations,
      introduced: grammar.opened,
      stable: grammar.stable,
      due: dueOf("grammar_unit") + dueOf("conjugation"),
      text: null,
      texts: null,
    },
    {
      skill: "listening",
      level: listening.level,
      // The bar counts texts (PRD §9.6); sentence listening alone leaves it empty.
      progress: heard.bar.progress,
      lock: listeningOpen ? null : drillWait ? { kind: "words", ...drillWait } : { kind: "more" },
      station: 0,
      stations: 0,
      introduced: drills.heard,
      stable: drills.done,
      // Sentences have no due date (PRD §7.6); texts bring theirs.
      due: heard.due,
      text: heard.waiting,
      texts: heard.texts,
    },
    {
      skill: "reading",
      level: reading.level,
      progress: read.bar.progress,
      lock: read.open ? null : { kind: "more" },
      station: 0,
      stations: 0,
      introduced: 0,
      stable: 0,
      due: read.due,
      text: read.waiting,
      texts: read.texts,
    },
  ];

  const open = await openSession(user.id, language);
  return {
    language,
    overall: overallLevel(content, { vocab: vocab.level, grammar: grammarOpen ? gLevel : null, listening: heard.open ? listening.level : null, reading: read.open ? reading.level : null }),
    streak: { count: streak.streakCount, today: doneToday(streak, today), freezes: streak.freezeCount },
    start: { minutes: preview.minutes, reviews: preview.reviews, newItems: preview.newItems, empty: preview.empty, resume: !!open && open.scope === "mixed", resumeText: preview.resumeText },
    quick: preview.quick,
    extra: preview.extra,
    plan: await planLine(user, enrollment, now),
    locked: !(await canPractice(db, user, enrollment, now)),
    skills,
    links: {
      notebook: openEntries(learner.notebook, now).filter((note) => {
        const card = noteCard(content, note);
        return !!card && live(card);
      }).length,
      words: learner.items.filter((item) => item.itemType === "word" && content.words.get(item.itemId) && hasCard(content.words.get(item.itemId)!)).length,
      lessons: learner.items.filter((item) => item.itemType === "grammar_unit").length,
      texts: content.texts.filter((text) => learner.texts.some((state) => state.textId === text.id && stageDone(state))).length,
      phonics: content.phonics.length > 0 ? phonicsProgress(content, learner.phonics) : null,
    },
  };
}
