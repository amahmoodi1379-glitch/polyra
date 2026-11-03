import { randomUUID } from "node:crypto";
import type { Ex, RawAnswer } from "@/engine/ex";
import { grade } from "@/engine/grade";
import {
  applySampleAnswer,
  placementAnswer,
  placementNext,
  placementOutcome,
  placementResult,
  placementStop,
  startPlacement as startRun,
  type PlacementAsk,
  type PlacementResult,
  type PlacementState,
  type SampleState,
} from "@/engine/placement";
import { dictSource, gradeQuestion, stageScore, type QuestionAnswer } from "@/engine/questions";
import type { SampleAnswer } from "@/engine/session/play";
import type { TextView } from "@/engine/session/types";
import { textView } from "@/engine/session/views";
import { itemKey, type ItemStateE, type SkillLevelE } from "@/engine/state";
import { tehranDate } from "@/engine/time";
import type { Prisma } from "@/generated/prisma/client";
import type { LanguageCode } from "@/server/content/languages";
import { db } from "@/server/db";
import { canPractice, phoneHash } from "./access";
import { itemStateOf, skillsOf } from "./learner";
import { learnContext, type LearnContext, type Learner } from "./session";
import { saveItemState } from "./writes";

/**
 * Placement on the server (PRD §11.1–§11.4): one `placement_run` per language while the test runs
 * (`state = "running"`, the engine's state in `result.progress`), then `state = "done"` with the
 * result and the sample in `sample_state`. Every answer is graded here against the question kept in
 * the run, so the browser never decides; each one is a `review_log` row with `kind = placement`.
 */

type Tx = Prisma.TransactionClient;

export type StoredRun = { progress: PlacementState; result?: PlacementResult };

/** A question as the browser gets it: the answer key stays on the server. */
export type PlacementScreen =
  | { kind: "question"; part: "vocab" | "grammar"; level: string; number: number; size: number; ex: Ex }
  | { kind: "text"; track: "listening" | "reading"; level: string; view: TextView; rules: Extract<PlacementAsk, { kind: "text" }>["rules"] }
  | { kind: "done"; result: PlacementResult };

const running = (userId: number, language: string, client: Tx | typeof db = db) =>
  client.placementRun.findFirst({ where: { user_id: userId, language, state: "running" }, orderBy: { started_at: "desc" } });

/** The run of a language in progress, if any: the home shows «ادامه تعیین سطح» and «از همین‌جا شروع کن» (PRD §11.1). */
export async function placementRunning(userId: number, language: string): Promise<boolean> {
  return !!(await running(userId, language));
}

/** The last finished run's result and sample, for the result screen and the panel. */
export async function lastPlacement(userId: number, language: string) {
  const row = await db.placementRun.findFirst({ where: { user_id: userId, language, state: "done" }, orderBy: { started_at: "desc" } });
  if (!row) return null;
  const stored = row.result as unknown as StoredRun | null;
  return {
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: stored?.result ?? null,
    texts: stored?.progress.texts ?? [],
    sample: (row.sample_state as unknown as SampleState | null) ?? null,
  };
}

/**
 * «تعیین سطح» on the start screen (PRD §3.1, §11.1): the enrollment (start mode `placement`) and a run.
 * Placement does not start the free period (PRD §12.1); a number that already had it gets none here
 * either. It is once per language: a language already started can not take it again.
 */
export async function beginPlacement(user: Learner & { phone: string | null }, language: LanguageCode, now = new Date()): Promise<"started" | "running" | "taken"> {
  const ctx = await learnContext(user, language, now);
  const used = user.phone ? await db.trialLedger.findUnique({ where: { phone_hash_language: { phone_hash: phoneHash(user.phone), language } }, select: { id: true } }) : null;
  return db.$transaction(async (tx) => {
    const enrollment = await tx.enrollment.findUnique({ where: { user_id_language: { user_id: user.id, language } }, select: { id: true } });
    if (enrollment) return (await running(user.id, language, tx)) ? "running" : "taken";
    await tx.enrollment.create({ data: { user_id: user.id, language, start_mode: "placement", created_at: now, ...(used ? { trial_started_at: now, trial_ends_at: now } : {}) } });
    const progress = startRun(ctx.content, ctx.settings, randomUUID());
    await tx.placementRun.create({ data: { user_id: user.id, language, state: "running", started_at: now, result: { progress } as unknown as Prisma.InputJsonValue } });
    await tx.event.create({ data: { user_id: user.id, language, name: "placement_start", props: {}, ts: now } });
    return "started";
  });
}

function screenOf(ctx: LearnContext, ask: PlacementAsk): PlacementScreen {
  if (ask.kind === "text") {
    const text = ctx.content.texts.find((item) => item.id === ask.textId)!;
    const view = textView(ctx.content, text, ask.track);
    // No help in the test (PRD §11.1): no translation and no word to touch.
    const plain = { ...view, sentences: view.sentences.map((sentence) => ({ ...sentence, translation: "", glosses: [] })) };
    return { kind: "text", track: ask.track, level: ask.level, view: plain, rules: ask.rules };
  }
  const ex = ask.ex;
  // The right option is not sent: the server grades (PRD §15.4).
  const a = ex.a.kind === "choice" ? { ...ex.a, correct: "" } : ex.a;
  return { kind: "question", part: ask.part, level: ask.level, number: ask.number, size: ask.size, ex: { ...ex, a } };
}

/** What the placement page shows now: the question on screen, or the result when the test is over. */
export async function placementScreen(user: Learner, language: LanguageCode, now = new Date()): Promise<PlacementScreen | null> {
  const row = await running(user.id, language);
  if (!row) {
    const last = await lastPlacement(user.id, language);
    return last?.result ? { kind: "done", result: last.result } : null;
  }
  const ctx = await learnContext(user, language, now);
  const stored = row.result as unknown as StoredRun;
  const next = placementNext(ctx.content, ctx.settings, stored.progress);
  if (!next.ask) {
    const result = await db.$transaction((tx) => finishRun(tx, row.id, user, language, next.state, ctx, now));
    return { kind: "done", result };
  }
  if (next.state !== stored.progress) await db.placementRun.update({ where: { id: row.id }, data: { result: { progress: next.state } as unknown as Prisma.InputJsonValue } });
  return screenOf(ctx, next.ask);
}

export type PlacementInput = { answer: RawAnswer } | { answers: Record<string, QuestionAnswer> } | { stop: true };

/**
 * One answer, or «ادامه نمی‌دهم» (PRD §11.2). `number` is the question the browser showed: an answer
 * to an older question (a double tap, a second tab) changes nothing.
 */
export async function placementInput(user: Learner, language: LanguageCode, input: PlacementInput, shown: { part: string; number: number } | null, now = new Date()): Promise<PlacementScreen | null> {
  const ctx = await learnContext(user, language, now);
  const outcome = await db.$transaction(async (tx) => {
    const row = await running(user.id, language, tx);
    if (!row) return null;
    await tx.$queryRaw`SELECT id FROM placement_run WHERE id = ${row.id} FOR UPDATE`;
    const stored = (await tx.placementRun.findUniqueOrThrow({ where: { id: row.id } })).result as unknown as StoredRun;
    let state = stored.progress;
    if ("stop" in input) {
      state = placementStop(ctx.content, ctx.settings, state);
    } else {
      const current = state.current;
      if (!current) return "stale" as const;
      if (current.kind === "question") {
        if (!("answer" in input) || !shown || shown.part !== current.part || shown.number !== current.number) return "stale" as const;
        const graded = grade(current.ex, input.answer, { language: ctx.content.language, wordsWithLemma: (lemma) => ctx.content.lemmaIndex.get(lemma) ?? [] });
        if (graded.result === "synonym" || graded.result === "persian") return "stale" as const;
        await tx.reviewLog.create({
          data: {
            id: randomUUID(),
            user_id: user.id,
            language,
            kind: "placement",
            item_type: current.part === "vocab" ? "word" : "grammar_target",
            item_id: current.part === "vocab" ? Number(current.ex.item.slice(2)) : current.ex.targetId,
            exercise_code: current.ex.code,
            sentence_id: current.ex.sentenceId,
            sentence_target_id: current.ex.targetId,
            result: graded.result,
            raw_answer: graded.raw,
            ts: now,
          },
        });
        state = placementAnswer(ctx.content, ctx.settings, state, graded.result);
      } else {
        if (!("answers" in input) || shown?.part !== current.track) return "stale" as const;
        const text = ctx.content.texts.find((item) => item.id === current.textId);
        const questions = text?.questions[current.track].A ?? [];
        const sentences = text ? textView(ctx.content, text, current.track).sentences : [];
        const graded = questions.map((question) =>
          gradeQuestion(question, input.answers[String(question.id)], {
            lang: ctx.content.language,
            sentence: question.type === "dict" && sentences[question.sentence] ? dictSource(sentences[question.sentence]) : undefined,
          }),
        );
        if (graded.length > 0) {
          await tx.reviewLog.createMany({
            data: graded.map((one) => ({
              id: randomUUID(),
              user_id: user.id,
              language,
              kind: "placement" as const,
              item_type: "text",
              item_id: current.textId,
              question_id: one.questionId,
              question_set: "A",
              result: one.result,
              raw_answer: one.raw,
              ts: now,
            })),
          });
        }
        state = placementAnswer(ctx.content, ctx.settings, state, { score: stageScore(graded) });
      }
    }
    const next = placementNext(ctx.content, ctx.settings, state);
    if (!next.ask) return { kind: "done" as const, result: await finishRun(tx, row.id, user, language, next.state, ctx, now) };
    await tx.placementRun.update({ where: { id: row.id }, data: { result: { progress: next.state } as unknown as Prisma.InputJsonValue } });
    return { kind: "ask" as const, ask: next.ask };
  });
  if (outcome === null) return null;
  if (outcome === "stale") return placementScreen(user, language, now);
  if (outcome.kind === "done") return { kind: "done", result: outcome.result };
  return screenOf(ctx, outcome.ask);
}

/**
 * The end of the test (PRD §11.3): the four skills, `placement_done`, phonics, the texts used, and the
 * sample with its probation cards. The free period does not start (PRD §12.1).
 */
async function finishRun(tx: Tx, runId: number, user: Learner, language: string, state: PlacementState, ctx: LearnContext, now: Date): Promise<PlacementResult> {
  const result = placementResult(ctx.content, ctx.settings, state);
  const today = tehranDate(now);
  const outcome = placementOutcome(ctx.content, ctx.settings, result, state.seed, now, today);
  const where = { user_id: user.id, language };
  for (const skill of outcome.skills) {
    const data = { level: skill.level, known_below: skill.knownBelow };
    await tx.skillLevel.upsert({ where: { user_id_language_skill: { ...where, skill: skill.skill } }, create: { ...where, skill: skill.skill, ...data }, update: data });
  }
  for (const card of outcome.cards) await saveItemState(tx, { userId: user.id, language }, card);
  for (const used of result.texts) {
    await tx.textState.upsert({
      where: { user_id_text_id_track: { user_id: user.id, text_id: used.textId, track: used.track } },
      create: { user_id: user.id, text_id: used.textId, track: used.track, used_in_test: true },
      update: { used_in_test: true },
    });
  }
  await tx.enrollment.update({ where: { user_id_language: { user_id: user.id, language } }, data: { placement_done: true, phonics_auto: result.phonicsAuto } });
  await tx.placementRun.update({
    where: { id: runId },
    data: {
      state: "done",
      finished_at: now,
      result: { progress: state, result } as unknown as Prisma.InputJsonValue,
      sample_state: outcome.sample as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.event.create({ data: { user_id: user.id, language, name: "placement_end", props: { stopped: result.stopped }, ts: now } });
  return result;
}

/**
 * An answer of a session that counts in the sample (PRD §11.4), in the answer's transaction: the
 * count, and on a failure the skill rows and the sample cards not asked yet.
 */
export async function recordSample(tx: Tx, userId: number, language: string, answer: SampleAnswer, ctx: LearnContext): Promise<void> {
  const run = await tx.placementRun.findFirst({ where: { user_id: userId, language, state: "done" }, orderBy: { started_at: "desc" } });
  const sample = run?.sample_state as unknown as SampleState | null;
  if (!run || !sample) return;
  const where = { user_id: userId, language };
  const [skillRows, itemRows] = await Promise.all([tx.skillLevel.findMany({ where }), tx.itemState.findMany({ where: { ...where, probation: "sample" } })]);
  const skills: SkillLevelE[] = skillsOf(skillRows, ctx.content.levels[0]);
  const items: ItemStateE[] = itemRows.map(itemStateOf);
  const done = applySampleAnswer(sample, answer, skills, items, ctx.settings);
  await tx.placementRun.update({ where: { id: run.id }, data: { sample_state: done.sample as unknown as Prisma.InputJsonValue } });
  if (done.skills) {
    for (const skill of done.skills) {
      const data = { level: skill.level, known_below: skill.knownBelow };
      await tx.skillLevel.upsert({ where: { user_id_language_skill: { ...where, skill: skill.skill } }, create: { ...where, skill: skill.skill, ...data }, update: data });
    }
  }
  const remove = items.filter((item) => done.remove.includes(itemKey(item.itemType, item.itemId))).map((item) => item.itemId);
  if (remove.length > 0) await tx.itemState.deleteMany({ where: { ...where, item_type: "word", item_id: { in: remove }, probation: "sample" } });
}

/** The sample's message waiting for the end of a session (PRD §11.4), taken once it is shown. */
export async function takeSampleNotice(tx: Tx, userId: number, language: string): Promise<{ kind: "vocab" | "grammar"; level: string } | null> {
  const run = await tx.placementRun.findFirst({ where: { user_id: userId, language, state: "done" }, orderBy: { started_at: "desc" } });
  const sample = run?.sample_state as unknown as SampleState | null;
  if (!run || !sample) return null;
  const which = sample.vocab?.notice ? "vocab" : sample.grammar?.notice ? "grammar" : null;
  if (!which) return null;
  const next: SampleState = which === "vocab" ? { ...sample, vocab: { ...sample.vocab!, notice: false } } : { ...sample, grammar: { ...sample.grammar!, notice: false } };
  await tx.placementRun.update({ where: { id: run.id }, data: { sample_state: next as unknown as Prisma.InputJsonValue } });
  return { kind: which, level: which === "vocab" ? sample.vocab!.level : sample.grammar!.level };
}

/** Whether a learner may take or go on with the test (PRD §12.4): the same lock as sessions. */
export async function mayPlace(user: Learner, language: string, now = new Date()): Promise<boolean> {
  const enrollment = await db.enrollment.findUnique({ where: { user_id_language: { user_id: user.id, language } } });
  return !enrollment || canPractice(db, user, enrollment, now);
}
