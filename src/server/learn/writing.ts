import { weeklyWriting, writingActiveSec, writingMinToFinish, writingWords, type WeeklyWriting, type WritingTaskC } from "@/engine/production";
import { tehranDate, weekStart } from "@/engine/time";
import type { ContentStatus } from "@/generated/prisma/client";
import type { LanguageCode } from "@/server/content/languages";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { canPractice } from "./access";
import { moduleFilter, type Audience } from "./content";
import { countStreakDay } from "./finish";
import { asDate, skillsOf } from "./learner";
import { learnContext, type Learner } from "./session";
import { addDaily } from "./writes";

/**
 * The weekly guided writing (PRD §8b.6): this week's card on the home screen, its page, the finished
 * writing kept in «نوشته‌های من» (PRD §3.10). No score: a finished writing counts in the streak and its
 * time, up to `writing.max_minutes`, in active learning. A teacher or a tester may try any task; a try is not kept.
 */

const statusesOf = (audience: Audience): ContentStatus[] => (audience === "public" ? ["published"] : ["approved", "published"]);

/** The tasks a learner may get: visible, not suspended, of released levels (every level for a tester). */
export async function writingTasks(language: string, audience: Audience, modules: readonly string[] = []): Promise<WritingTaskC[]> {
  const levels = await appSetting<string[]>(`levels.${language}`);
  const released = audience !== "public" ? levels : (await db.levelRelease.findMany({ where: { language }, select: { level: true } })).map((row) => row.level);
  const rows = await db.writingTask.findMany({
    where: { language, status: { in: statusesOf(audience) }, suspended: false, level: { in: levels.filter((level) => released.includes(level)) }, ...(await moduleFilter(language, audience, modules)) },
  });
  return rows.map(writingTaskOf);
}

type WritingTaskRow = NonNullable<Awaited<ReturnType<typeof db.writingTask.findUnique>>>;

/** A stored writing task as the engine and the page read it; «بازبینی» uses it for any status. */
export function writingTaskOf(row: WritingTaskRow): WritingTaskC {
  return {
    id: row.id,
    level: row.level,
    promptFa: row.prompt_fa,
    minWords: row.min_words,
    maxWords: row.max_words,
    checklist: row.checklist_fa,
    phrases: (Array.isArray(row.useful_phrases) ? (row.useful_phrases as { text?: string; translation_fa?: string }[]) : []).map((phrase) => ({
      text: String(phrase.text ?? ""),
      translationFa: String(phrase.translation_fa ?? ""),
    })),
    modelAnswer: row.model_answer,
    modelAnswerFa: row.model_answer_fa,
  };
}

/** Writing rows of a learner in one language (`writing_entry` has no language of its own). */
async function writtenIn(userId: number, language: string) {
  return db.writingEntry.findMany({
    where: { user_id: userId, writing_task_id: { in: (await db.writingTask.findMany({ where: { language }, select: { id: true } })).map((row) => row.id) } },
    orderBy: { created_at: "desc" },
  });
}

export type WritingCard = WeeklyWriting & { level: string };

/** This week's writing card (PRD §8b.6) for the home screen and «آزمایش مثل زبان‌آموز». */
export async function writingCard(user: Learner, language: LanguageCode, now = new Date()): Promise<WritingCard> {
  const ctx = await learnContext(user, language, now);
  const [skills, tasks, written] = await Promise.all([
    db.skillLevel.findMany({ where: { user_id: user.id, language } }),
    writingTasks(language, ctx.audience, ctx.modules),
    writtenIn(user.id, language),
  ]);
  const vocab = skillsOf(skills, ctx.content.levels[0]).find((skill) => skill.skill === "vocab")!;
  const weekly = weeklyWriting(
    ctx.content,
    tasks,
    written.map((row) => ({ taskId: row.writing_task_id, at: row.created_at.toISOString() })),
    vocab.level,
    ctx.today,
    ctx.settings,
  );
  return { ...weekly, level: vocab.level };
}

export type WritingPage = {
  task: WritingTaskC;
  /** Words needed before «تمام شد» comes alive. */
  minToFinish: number;
  /** A teacher trying a task that is not this week's: nothing changes in their streak or week. */
  trying: boolean;
  locked: boolean;
};

/**
 * The writing page: this week's task, or for a teacher or a tester any visible task by its id.
 * Null when there is nothing to write.
 */
export async function writingPage(user: Learner, language: LanguageCode, taskId: number | null, now = new Date()): Promise<WritingPage | null> {
  const enrollment = await db.enrollment.findUnique({ where: { user_id_language: { user_id: user.id, language } } });
  if (!enrollment) return null;
  const locked = !(await canPractice(db, user, enrollment, now));
  const card = await writingCard(user, language, now);
  if (taskId !== null && (user.is_admin || user.is_tester)) {
    const ctx = await learnContext(user, language, now);
    const task = (await writingTasks(language, ctx.audience, ctx.modules)).find((item) => item.id === taskId);
    if (!task) return null;
    return { task, minToFinish: writingMinToFinish(task), trying: !(card.state === "open" && card.task.id === task.id), locked };
  }
  if (card.state !== "open") return null;
  return { task: card.task, minToFinish: writingMinToFinish(card.task), trying: false, locked };
}

export type SaveWriting = { language: LanguageCode; taskId: number; text: string; ticks: number[]; seconds: number };

/**
 * A finished writing (PRD §8b.6): kept in `writing_entry` with the checklist ticks; it marks the week
 * done, counts today in the streak and its time in active learning. A teacher's or a tester's try of a
 * task that is not this week's is not kept: they see the model answer and nothing changes.
 */
export async function saveWriting(user: Learner, input: SaveWriting, now = new Date()): Promise<{ kind: "ok"; id: number | null } | { kind: "invalid" | "locked" | "short" }> {
  const page = await writingPage(user, input.language, input.taskId, now);
  if (!page || page.task.id !== input.taskId) return { kind: "invalid" };
  if (page.locked) return { kind: "locked" };
  if (writingWords(input.text) < page.minToFinish) return { kind: "short" };
  // A teacher's or a tester's try of a task that is not this week's is not kept (DECISIONS.md).
  if (page.trying) return { kind: "ok", id: null };
  const ctx = await learnContext(user, input.language, now);
  const ticks = [...new Set(input.ticks)].filter((tick) => Number.isInteger(tick) && tick >= 0 && tick < page.task.checklist.length).sort((a, b) => a - b);
  const today = tehranDate(now);
  return db.$transaction(async (tx) => {
    const entry = await tx.writingEntry.create({ data: { user_id: user.id, writing_task_id: page.task.id, text: input.text.trim(), checklist_ticks: ticks, created_at: now } });
    const who = { userId: user.id, language: input.language };
    await addDaily(tx, who, today, { active_sec: writingActiveSec(input.seconds, ctx.settings) });
    const enrollment = await tx.enrollment.update({
      where: { user_id_language: { user_id: user.id, language: input.language } },
      data: { writing_done_week: asDate(weekStart(today)) },
    });
    await countStreakDay(tx, enrollment, today, ctx.settings);
    return { kind: "ok" as const, id: entry.id };
  });
}

/** Ticks of the checklist, changed on the page after the model answer (PRD §8b.6, step 3). */
export async function tickWriting(user: Learner, id: number, ticks: number[]): Promise<boolean> {
  const entry = await db.writingEntry.findUnique({ where: { id } });
  if (!entry || entry.user_id !== user.id) return false;
  const task = await db.writingTask.findUnique({ where: { id: entry.writing_task_id }, select: { checklist_fa: true } });
  const clean = [...new Set(ticks)].filter((tick) => Number.isInteger(tick) && tick >= 0 && tick < (task?.checklist_fa.length ?? 0)).sort((a, b) => a - b);
  await db.writingEntry.update({ where: { id }, data: { checklist_ticks: clean } });
  return true;
}

export type WritingEntryView = { id: number; at: string; text: string; ticks: number[]; task: Pick<WritingTaskC, "promptFa" | "level" | "checklist" | "modelAnswer" | "modelAnswerFa"> };

/** «نوشته‌های من» (PRD §3.10): every writing, the newest first, beside its model answer. */
export async function myWritings(user: Learner, language: LanguageCode): Promise<WritingEntryView[]> {
  const rows = await writtenIn(user.id, language);
  const tasks = new Map((await db.writingTask.findMany({ where: { id: { in: rows.map((row) => row.writing_task_id) } } })).map((row) => [row.id, row]));
  return rows.flatMap((row) => {
    const task = tasks.get(row.writing_task_id);
    if (!task) return [];
    return [
      {
        id: row.id,
        at: row.created_at.toISOString(),
        text: row.text,
        ticks: Array.isArray(row.checklist_ticks) ? row.checklist_ticks.map(Number) : [],
        task: { promptFa: task.prompt_fa, level: task.level, checklist: task.checklist_fa, modelAnswer: task.model_answer, modelAnswerFa: task.model_answer_fa },
      },
    ];
  });
}
