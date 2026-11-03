import { randomUUID } from "node:crypto";
import type { Ex, RawAnswer } from "@/engine/ex";
import { examAnswer, examNext, examOffer, examResult, examSkills, startExam, type ExamAsk, type ExamLearner, type ExamOffer, type ExamResult, type ExamState } from "@/engine/exam";
import { grade } from "@/engine/grade";
import { dictSource, gradeQuestion, stageScore, type QuestionAnswer } from "@/engine/questions";
import type { TextView } from "@/engine/session/types";
import { textView } from "@/engine/session/views";
import type { SkillName } from "@/engine/state";
import type { Prisma } from "@/generated/prisma/client";
import type { LanguageCode } from "@/server/content/languages";
import { db } from "@/server/db";
import { canPractice } from "./access";
import { itemStateOf, loadTextStates, skillsOf, textStateOf } from "./learner";
import { learnContext, type LearnContext, type Learner } from "./session";

/**
 * «پرش از این سطح» on the server (PRD §11.6): one `level_exam` row per exam, its engine state in `state`
 * while it runs, then the score, the result and `finished_at`. The server grades every answer against the
 * question it kept, writes it to `review_log` with `kind = exam` and touches no card. A pass moves the
 * skill's level; the texts used get `used_in_test`.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

export const EXAM_SKILLS: readonly SkillName[] = ["vocab", "grammar", "listening", "reading"];

/** What the browser gets: the answer key stays here. */
export type ExamScreen =
  | { kind: "question"; skill: SkillName; level: string; number: number; size: number; ex: Ex }
  | { kind: "text"; skill: SkillName; level: string; number: number; size: number; view: TextView; info: Extract<ExamAsk, { kind: "text" }> }
  | { kind: "done"; skill: SkillName; level: string; next: string; result: ExamResult; retryOn: string | null };

/** A skill's exam on the skill sheet: the offer, and whether one is half-way. */
export type ExamTile = { offer: ExamOffer; running: { next: string } | null };

async function examLearner(client: Client, userId: number, language: string, lowest: string): Promise<ExamLearner> {
  const where = { user_id: userId, language };
  const [skills, items, texts] = await Promise.all([client.skillLevel.findMany({ where }), client.itemState.findMany({ where }), loadTextStates(client, userId, language)]);
  return { skills: skillsOf(skills, lowest), items: items.map(itemStateOf), texts: texts.map(textStateOf) };
}

const runningRow = (client: Client, userId: number, language: string, skill: SkillName) =>
  client.levelExam.findFirst({ where: { user_id: userId, language, skill, finished_at: null }, orderBy: { taken_at: "desc" } });

/** When the last exam of this skill at this level was failed, for the wait before the next (PRD §11.6). */
async function lastFail(client: Client, userId: number, language: string, skill: SkillName, level: string): Promise<Date | null> {
  const row = await client.levelExam.findFirst({ where: { user_id: userId, language, skill, level, passed: false, NOT: { finished_at: null } }, orderBy: { finished_at: "desc" }, select: { finished_at: true } });
  return row?.finished_at ?? null;
}

/** The four skills' exam buttons for the home (PRD §3.3). */
export async function examTiles(user: Learner, language: string, ctx: LearnContext): Promise<Record<SkillName, ExamTile>> {
  const learner = await examLearner(db, user.id, language, ctx.content.levels[0]);
  const out = {} as Record<SkillName, ExamTile>;
  for (const skill of EXAM_SKILLS) {
    const row = await runningRow(db, user.id, language, skill);
    const running = row ? { next: (row.state as unknown as ExamState).next } : null;
    const probe = examOffer(ctx.content, learner, skill, ctx.settings, null, ctx.now);
    const fail = probe.kind === "ready" ? await lastFail(db, user.id, language, skill, probe.level) : null;
    out[skill] = { offer: fail ? examOffer(ctx.content, learner, skill, ctx.settings, fail, ctx.now) : probe, running };
  }
  return out;
}

/** One skill's offer, in a transaction (the end message of PRD §3.11 row 4). */
export async function examOfferFor(client: Client, userId: number, language: string, ctx: LearnContext, skill: SkillName): Promise<ExamOffer> {
  const learner = await examLearner(client, userId, language, ctx.content.levels[0]);
  const probe = examOffer(ctx.content, learner, skill, ctx.settings, null, ctx.now);
  const fail = probe.kind === "ready" ? await lastFail(client, userId, language, skill, probe.level) : null;
  return fail ? examOffer(ctx.content, learner, skill, ctx.settings, fail, ctx.now) : probe;
}

/** Whether the learner may take an exam: enrolled and not locked (PRD §12.4), like a session. */
async function mayTake(user: Learner, language: string, now: Date): Promise<boolean> {
  const enrollment = await db.enrollment.findUnique({ where: { user_id_language: { user_id: user.id, language } } });
  return !!enrollment && (await canPractice(db, user, enrollment, now));
}

/** «پرش از این سطح»: starts the exam, or finds the one half-way. */
export async function beginExam(user: Learner, language: LanguageCode, skill: SkillName, now = new Date()): Promise<"started" | "running" | "unavailable"> {
  if (!(await mayTake(user, language, now))) return "unavailable";
  const ctx = await learnContext(user, language, now);
  return db.$transaction(async (tx) => {
    if (await runningRow(tx, user.id, language, skill)) return "running";
    const learner = await examLearner(tx, user.id, language, ctx.content.levels[0]);
    const probe = examOffer(ctx.content, learner, skill, ctx.settings, null, now);
    const fail = probe.kind === "ready" ? await lastFail(tx, user.id, language, skill, probe.level) : null;
    const state = startExam(ctx.content, learner, skill, ctx.settings, randomUUID(), fail, now);
    if (!state) return "unavailable";
    await tx.levelExam.create({ data: { user_id: user.id, language, skill, level: state.level, taken_at: now, score: 0, passed: false, state: state as unknown as Prisma.InputJsonValue } });
    await tx.event.create({ data: { user_id: user.id, language, name: "exam_start", props: { skill, level: state.level }, ts: now } });
    return "started";
  });
}

function screenOf(ctx: LearnContext, state: ExamState, ask: ExamAsk): ExamScreen {
  const base = { skill: state.skill, level: state.level, number: ask.number, size: ask.size };
  if (ask.kind === "text") {
    const text = ctx.content.texts.find((item) => item.id === ask.textId)!;
    const view = textView(ctx.content, text, ask.track);
    // No help in an exam (PRD §11.6): no translation and no word to touch.
    const plain = { ...view, sentences: view.sentences.map((sentence) => ({ ...sentence, translation: "", glosses: [] })) };
    return { kind: "text", ...base, view: plain, info: ask };
  }
  const ex = ask.ex;
  const a = ex.a.kind === "choice" ? { ...ex.a, correct: "" } : ex.a;
  return { kind: "question", ...base, ex: { ...ex, a } };
}

/** What the exam page shows now: the question on screen, or null when no exam of the skill runs. */
export async function examScreen(user: Learner, language: LanguageCode, skill: SkillName, now = new Date()): Promise<ExamScreen | null> {
  const row = await runningRow(db, user.id, language, skill);
  if (!row) return null;
  const ctx = await learnContext(user, language, now);
  const stored = row.state as unknown as ExamState;
  const next = examNext(ctx.content, ctx.settings, stored);
  if (!next.ask) return db.$transaction((tx) => finish(tx, row.id, user, language, next.state, ctx, now));
  if (next.state !== stored) await db.levelExam.update({ where: { id: row.id }, data: { state: next.state as unknown as Prisma.InputJsonValue } });
  return screenOf(ctx, next.state, next.ask);
}

export type ExamInput = { answer: RawAnswer } | { answers: Record<string, QuestionAnswer> };

/** One answer. `number` is the item the browser showed: an answer to another one changes nothing. */
export async function examInput(user: Learner, language: LanguageCode, skill: SkillName, input: ExamInput, number: number, now = new Date()): Promise<ExamScreen | null> {
  const ctx = await learnContext(user, language, now);
  const outcome = await db.$transaction(async (tx) => {
    const row = await runningRow(tx, user.id, language, skill);
    if (!row) return null;
    await tx.$queryRaw`SELECT id FROM level_exam WHERE id = ${row.id} FOR UPDATE`;
    const fresh = await tx.levelExam.findUniqueOrThrow({ where: { id: row.id } });
    if (fresh.finished_at) return null;
    let state = fresh.state as unknown as ExamState;
    const current = state.current;
    if (!current || current.number !== number) return "stale" as const;
    const log = { user_id: user.id, language, kind: "exam" as const, ts: now };
    if (current.kind === "question") {
      if (!("answer" in input)) return "stale" as const;
      const graded = grade(current.ex, input.answer, { language: ctx.content.language, wordsWithLemma: (lemma) => ctx.content.lemmaIndex.get(lemma) ?? [] });
      if (graded.result === "synonym" || graded.result === "persian") return "stale" as const;
      const word = current.ex.item.startsWith("w:");
      await tx.reviewLog.create({
        data: {
          ...log,
          id: randomUUID(),
          item_type: word ? "word" : "grammar_target",
          item_id: word ? Number(current.ex.item.slice(2)) : current.ex.targetId,
          exercise_code: current.ex.code,
          sentence_id: current.ex.sentenceId,
          sentence_target_id: current.ex.targetId,
          result: graded.result,
          result_reason: graded.reason,
          raw_answer: graded.raw,
        },
      });
      state = examAnswer(state, { result: graded.result });
    } else {
      if (!("answers" in input)) return "stale" as const;
      const text = ctx.content.texts.find((item) => item.id === current.textId);
      const questions = text?.questions[current.track][current.set] ?? [];
      const sentences = text ? textView(ctx.content, text, current.track).sentences : [];
      const graded = questions.map((question) =>
        gradeQuestion(question, input.answers[String(question.id)], {
          lang: ctx.content.language,
          sentence: question.type === "dict" && sentences[question.sentence] ? dictSource(sentences[question.sentence]) : undefined,
        }),
      );
      if (graded.length > 0) {
        await tx.reviewLog.createMany({
          data: graded.map((one) => ({ ...log, id: randomUUID(), item_type: "text", item_id: current.textId, question_id: one.questionId, question_set: current.set, result: one.result, raw_answer: one.raw })),
        });
      }
      state = examAnswer(state, { textId: current.textId, score: stageScore(graded), questions: graded.length });
    }
    const next = examNext(ctx.content, ctx.settings, state);
    if (!next.ask) return { kind: "done" as const, screen: await finish(tx, row.id, user, language, next.state, ctx, now) };
    await tx.levelExam.update({ where: { id: row.id }, data: { state: next.state as unknown as Prisma.InputJsonValue } });
    return { kind: "ask" as const, state: next.state, ask: next.ask };
  });
  if (outcome === null) return null;
  if (outcome === "stale") return examScreen(user, language, skill, now);
  if (outcome.kind === "done") return outcome.screen;
  return screenOf(ctx, outcome.state, outcome.ask);
}

/** The end (PRD §11.6): the score and result, the skill on a pass, the texts used. */
async function finish(tx: Tx, id: number, user: Learner, language: string, state: ExamState, ctx: LearnContext, now: Date): Promise<ExamScreen> {
  const result = examResult(ctx.settings, state);
  const where = { user_id: user.id, language };
  if (result.passed) {
    const skills = examSkills(skillsOf(await tx.skillLevel.findMany({ where }), ctx.content.levels[0]), state, result);
    const row = skills.find((one) => one.skill === state.skill)!;
    const data = { level: row.level, known_below: row.knownBelow };
    await tx.skillLevel.upsert({ where: { user_id_language_skill: { ...where, skill: row.skill } }, create: { ...where, skill: row.skill, ...data }, update: data });
  }
  for (const text of state.texts) {
    const track = state.skill as "listening" | "reading";
    await tx.textState.upsert({
      where: { user_id_text_id_track: { user_id: user.id, text_id: text.textId, track } },
      create: { user_id: user.id, text_id: text.textId, track, used_in_test: true },
      update: { used_in_test: true },
    });
  }
  await tx.levelExam.update({ where: { id }, data: { score: result.score, passed: result.passed, finished_at: now, state: { ...state, current: null } as unknown as Prisma.InputJsonValue } });
  await tx.event.create({ data: { ...where, name: "exam_end", props: { skill: state.skill, level: state.level, passed: result.passed, score: result.score }, ts: now } });
  const retry = result.passed ? null : examOffer(ctx.content, await examLearner(tx, user.id, language, ctx.content.levels[0]), state.skill, ctx.settings, now, now);
  return { kind: "done", skill: state.skill, level: state.level, next: state.next, result, retryOn: retry?.kind === "wait" ? retry.until : null };
}
