import { hasCard, levelIndex } from "@/engine/content";
import { grammarLevel, grammarProgress, indexItems, overallLevel, vocabProgress } from "@/engine/levels";
import { openEntries } from "@/engine/notebook";
import { isDue } from "@/engine/session/build";
import { introducedCardWords } from "@/engine/session/newmaterial";
import { num } from "@/engine/settings";
import type { SkillName } from "@/engine/state";
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
  /** Why it is grey (PRD §10.3): words still needed, or a later version of the app. */
  lock: { kind: "words"; need: number; left: number } | { kind: "later" } | null;
  station: number;
  stations: number;
  introduced: number;
  stable: number;
  due: number;
};

export type HomeData = {
  language: LanguageCode;
  overall: string;
  streak: { count: number; today: boolean; freezes: number };
  start: { minutes: number; reviews: number; newItems: number; empty: boolean; resume: boolean };
  quick: boolean;
  locked: boolean;
  skills: SkillTile[];
  links: { notebook: number; words: number; lessons: number };
};

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
  const dueOf = (type: string) => learner.items.filter((item) => item.itemType === type && isDue(item, now, today)).length;
  const fromStart = levelIndex(content, vocabSkill.knownBelow) <= 0;
  const introduced = introducedCardWords(content, learner.items);
  const gate = num(settings, "gate.grammar_words");
  const grammarOpen = !fromStart || introduced >= gate;
  const gLevel = grammarLevel(content, items);
  const grammar = grammarProgress(content, items, gLevel, settings);

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
    },
    // Listening and reading come with texts in the next phase.
    ...(["listening", "reading"] as const).map(
      (skill): SkillTile => ({ skill, level: content.levels[0], progress: 0, lock: { kind: "later" }, station: 0, stations: 0, introduced: 0, stable: 0, due: 0 }),
    ),
  ];

  const open = await openSession(user.id, language);
  return {
    language,
    overall: overallLevel(content, { vocab: vocab.level, grammar: grammarOpen ? gLevel : null, listening: null, reading: null }),
    streak: { count: streak.streakCount, today: doneToday(streak, today), freezes: streak.freezeCount },
    start: { minutes: preview.minutes, reviews: preview.reviews, newItems: preview.newItems, empty: preview.empty, resume: !!open && open.scope === "mixed" },
    quick: preview.quick,
    locked: !(await canPractice(db, user, enrollment, now)),
    skills,
    links: {
      notebook: openEntries(learner.notebook, now).length,
      words: learner.items.filter((item) => item.itemType === "word" && content.words.get(item.itemId) && hasCard(content.words.get(item.itemId)!)).length,
      lessons: learner.items.filter((item) => item.itemType === "grammar_unit").length,
    },
  };
}
