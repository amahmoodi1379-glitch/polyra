import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RawAnswer } from "@/engine/ex";
import { phonicsProgress, phonicsSkipsAfter } from "@/engine/phonics";
import { colloquialFor } from "@/engine/session/newmaterial";
import { needsSound, playCard } from "@/engine/session/play";
import { num } from "@/engine/settings";
import { itemKey, parseItemKey } from "@/engine/state";
import { tehranDate } from "@/engine/time";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { logError } from "@/server/errors";
import { finishSession } from "./finish";
import { recordSample } from "./placement";
import { asDate, loadPhonicsStates, textStateRow } from "./learner";
import { bundleOf, closeSession, expiresAt, learnContext, SESSION_LIFE_MS, type Bundle, type EndSummary, type Learner, type StoredPlan } from "./session";
import { addDaily, applyNotebookOps, saveConfusion, saveItemState, updatePretestMode, type DailyAdd } from "./writes";

/**
 * One finished card, sent by the browser (PRD §15.4): checked against the saved plan, graded again
 * with the same engine and written. Answers come one at a time in `seq` order; a repeated
 * `answer_id` is acknowledged and changes nothing.
 */

export const answerSchema = z.object({
  sessionId: z.uuid(),
  answerId: z.uuid(),
  seq: z.number().int().min(1),
  cardId: z.string().min(1).max(40),
  answer: z.record(z.string(), z.unknown()),
  latencyMs: z.number().min(0).max(86_400_000),
  elapsedSec: z.number().min(0).max(86_400),
  /** When the learner answered, on their device. */
  at: z.iso.datetime(),
  /** What the browser showed, to catch a difference (PRD §15.4, step 4). */
  shown: z.string().max(20).nullable(),
  /** The browser showed the card's version without sound (PRD §10.12). */
  alt: z.boolean().optional(),
});
export type AnswerRequest = z.infer<typeof answerSchema>;

/** One answer to a text question (`QuestionAnswer` of the engine), and a text stage's answers (PRD §7.3, §7.4). */
export const questionAnswer = z.union([
  z.object({ idk: z.literal(true) }),
  z.object({ choice: z.number().int() }),
  z.object({ value: z.boolean() }),
  z.object({ order: z.array(z.number().int()).max(40) }),
  z.object({ pairs: z.array(z.tuple([z.number().int(), z.number().int()])).max(40) }),
  z.object({ fills: z.array(z.string().max(200)).max(40) }),
  z.object({ sentence: z.number().int() }),
  z.object({ text: z.string().max(2000) }),
]);
export const textAnswers = z.record(z.string().max(12), questionAnswer);
const textAnswer = z.object({ answers: textAnswers, timedOut: z.boolean().optional() });
/** The start of a phonics round (PRD §8.4) and a liaison question's marks (P5). */
const phonicsStart = z.union([z.object({ seen: z.literal(true) }), z.object({ skip: z.enum(["later", "drop"]) })]);
const liaisonAnswer = z.union([z.object({ idk: z.literal(true) }), z.object({ gaps: z.array(z.number().int().min(0).max(200)).max(200) })]);
/** A phonics question left without sound (PRD §10.12): the rest of the round goes. */
const phonicsDrop = z.object({ skip: z.literal("drop") });
/** Speaking (PRD §8b): the learner's rating, a dialogue's first choices, find the mistake's changed words. */
const speakAnswer = z.object({ self: z.enum(["ok", "near", "no"]) });
const dialogueAnswer = z.object({ turns: z.array(z.number().int().min(-1).max(10)).max(20) });
const errorfixAnswer = z.object({ fixes: z.record(z.string().regex(/^\d{1,4}$/), z.string().max(60)).refine((fixes) => Object.keys(fixes).length <= 200) });

export type AnswerResponse =
  | { kind: "ok"; seq: number; finished: boolean; end: EndSummary | null }
  | { kind: "duplicate" }
  | { kind: "resync"; bundle: Bundle }
  | { kind: "gone" }
  | { kind: "invalid" };

export async function submitAnswer(user: Learner, request: AnswerRequest, serverNow = new Date()): Promise<AnswerResponse> {
  if (await db.reviewLog.findUnique({ where: { id: request.answerId }, select: { id: true } })) return { kind: "duplicate" };
  const first = await db.session.findUnique({ where: { id: request.sessionId } });
  if (!first || first.user_id !== user.id) return { kind: "gone" };
  // The device's time, kept between the build and now.
  const claimed = Date.parse(request.at);
  const at = new Date(Math.min(serverNow.getTime(), Math.max(first.created_at.getTime(), Number.isFinite(claimed) ? claimed : serverNow.getTime())));
  const ctx = await learnContext(user, first.language, at);

  const noted: { mismatch?: string } = {};
  const response = await db.$transaction(
    async (tx): Promise<AnswerResponse> => {
      await tx.$queryRaw`SELECT id FROM session WHERE id = ${request.sessionId}::uuid FOR UPDATE`;
      if (await tx.reviewLog.findUnique({ where: { id: request.answerId }, select: { id: true } })) return { kind: "duplicate" };
      const row = await tx.session.findUniqueOrThrow({ where: { id: request.sessionId } });
      if (row.ended_at) return { kind: "gone" };
      // Too late to resume, or arriving more than a day after the build (PRD §10.8, §15.4 step 9): the session ends.
      const expires = expiresAt(row, ctx.settings);
      if (at >= expires || serverNow.getTime() - row.created_at.getTime() > SESSION_LIFE_MS) {
        await closeSession(row, "expired", expires, ctx, tx);
        return { kind: "gone" };
      }
      const plan = row.plan as unknown as StoredPlan;
      if (request.seq !== row.next_seq || plan.queue[0]?.id !== request.cardId) return { kind: "resync", bundle: bundleOf(row, ctx, false) };

      // A text stage's answers, a phonics start or drop and liaison marks are checked before grading.
      const shownCard = plan.queue[0];
      // Only a card that needs sound may be dropped (PRD §10.12): a phonics question, a sentence heard alone, a listening text.
      const skipped = "skip" in request.answer;
      const dropped = skipped && shownCard.t !== "phonics" && phonicsDrop.safeParse(request.answer).success && needsSound(plan, shownCard);
      if (skipped && shownCard.t !== "phonics" && !dropped) return { kind: "invalid" };
      if (shownCard.t === "text" && !dropped && !textAnswer.safeParse(request.answer).success) return { kind: "invalid" };
      if (shownCard.t === "phonics" && !phonicsStart.safeParse(request.answer).success) return { kind: "invalid" };
      if (!dropped && shownCard.ex?.a.kind === "liaison" && !liaisonAnswer.safeParse(request.answer).success) return { kind: "invalid" };
      if (shownCard.prod && !dropped) {
        const schemas: Record<string, z.ZodType> = { speak: speakAnswer, dialogue: dialogueAnswer, errorfix: errorfixAnswer };
        if (!schemas[shownCard.prod.kind].safeParse(request.answer).success) return { kind: "invalid" };
      }
      const today = tehranDate(at);
      // «این را بلدم» (PRD §11.5): only on a card that offers it, while today's presses in every session are under `iknow.daily`.
      if ("iknow" in request.answer) {
        const offered = (shownCard.t === "intro" || shownCard.t === "lesson") && !!shownCard.probationStep && (plan.counters.iknowLeft ?? 0) > 0;
        if (!offered || request.answer.iknow !== true || Object.keys(request.answer).length !== 1) return { kind: "invalid" };
        const day = await tx.dailyCounter.findUnique({ where: { user_id_language_date_tehran: { user_id: user.id, language: row.language, date_tehran: asDate(today) } }, select: { i_know: true } });
        if ((day?.i_know ?? 0) >= num(ctx.settings, "iknow.daily")) return { kind: "invalid" };
      }
      const lexicon = ctx.content.lemmaIndex;
      const result = playCard(
        plan,
        request.cardId,
        request.answer as RawAnswer,
        { latencyMs: request.latencyMs, elapsedSec: request.elapsedSec, alt: request.alt },
        { ctx: { settings: ctx.settings, now: at, today, latency: plan.latency }, language: ctx.content.language, wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] },
      );
      // The browser sends only final answers; a synonym or Persian letters never reach the server.
      if (!result.done) return { kind: "invalid" };
      const server = result.graded?.result ?? "seen";
      if (request.shown && request.shown !== server) noted.mismatch = `The browser showed ${request.shown}, the server graded ${server} (card ${request.cardId})`;

      const who = { userId: user.id, language: row.language };
      const { log, card } = result;
      const turns = result.production?.kind === "dialogue" ? result.production.turns : [];
      const rows =
        turns.length > 0
          ? // A dialogue: one row per turn, its line and whether the first choice was right (PRD §8b.4).
            turns.map((turn, i) => ({
              id: i === 0 ? request.answerId : randomUUID(),
              question_id: null,
              question_set: null,
              sentence_id: turn.sentenceId,
              result: turn.right ? ("correct" as const) : ("wrong" as const),
              raw_answer: turn.choice === null ? null : String(turn.choice),
            }))
          : (result.text?.graded.length ? result.text.graded : [null]).map((graded, i) => ({
              // One row per question (PRD §4, «هر جواب یک ردیف»); the first carries the answer id that makes a repeat harmless.
              id: i === 0 ? request.answerId : randomUUID(),
              question_id: graded?.questionId ?? null,
              question_set: graded ? result.text!.set : null,
              sentence_id: log.sentenceId,
              result: graded?.result ?? log.result,
              raw_answer: graded ? graded.raw : log.raw,
            }));
      await tx.reviewLog.createMany({
        data: rows.map((one) => ({
          ...one,
          user_id: user.id,
          language: row.language,
          session_id: row.id,
          kind: log.kind,
          item_type: log.itemType,
          item_id: log.itemId,
          exercise_code: log.code,
          step_before: log.stepBefore,
          step_after: log.stepAfter,
          sentence_target_id: log.targetId,
          result_reason: log.reason,
          chosen_word_id: log.chosenWordId,
          first_typing: log.firstTyping,
          latency_ms: Math.round(request.latencyMs),
          fsrs_rating: log.rating,
          seq: request.seq,
          ts: at,
        })),
      });

      // Active learning (PRD §3.9): every answer and every intro card or lesson, each up to a minute.
      const add: DailyAdd = { active_sec: Math.round(Math.min(request.latencyMs / 1000, num(ctx.settings, "active.cap_sec"))) };
      let newWord = false;
      for (const state of [result.state, result.roundState]) {
        if (!state) continue;
        const isNew = await saveItemState(tx, who, state);
        if (!isNew) continue;
        if (state.itemType === "word") newWord = true;
        // «این را بلدم» and a passed «پیش‌آزمون» have their own daily counts, not the new-material caps (PRD §11.5).
        const known = state.source === "i_know" || state.source === "pretest";
        if (state.source === "i_know") add.i_know = (add.i_know ?? 0) + 1;
        else if (state.source === "pretest") add.pretest_passed = (add.pretest_passed ?? 0) + 1;
        if (state.itemType === "word") {
          if (!known) add.new_words = (add.new_words ?? 0) + 1;
          // A word from the queue leaves it (PRD §11.5 edge cases) and, unless claimed known, keeps where it came from (PRD §4, `item_state.source`).
          const queued = await tx.newWordQueue.findUnique({ where: { user_id_word_id: { user_id: user.id, word_id: state.itemId } } });
          if (queued) {
            await tx.newWordQueue.delete({ where: { id: queued.id } });
            if (!known) {
              await tx.itemState.updateMany({ where: { user_id: user.id, item_type: "word", item_id: state.itemId }, data: { source: queued.source } });
              if (plan.items[itemKey("word", state.itemId)]?.queued) add.queue_words = (add.queue_words ?? 0) + 1;
            }
          }
        } else if (known) continue;
        else if (state.itemType === "grammar_unit") add.new_units = (add.new_units ?? 0) + 1;
        else add.new_conj = (add.new_conj ?? 0) + 1;
      }
      await addDaily(tx, who, today, add);
      // «حالت پیش‌آزمون» after a new word or a «پیش‌آزمون» (PRD §11.5).
      if (result.known || newWord) await updatePretestMode(tx, who, ctx.settings);
      await applyNotebookOps(tx, who, result.notebook, at, today, ctx.settings);
      if (result.pair) await saveConfusion(tx, who, result.pair);
      // One more showing of a drilled sentence, whatever the answer (PRD §7.6).
      if (result.drill !== null) {
        await tx.sentenceDrillState.upsert({
          where: { user_id_sentence_id: { user_id: user.id, sentence_id: result.drill } },
          create: { user_id: user.id, sentence_id: result.drill, count: 1, last_at: at },
          update: { count: { increment: 1 }, last_at: at },
        });
      }
      // A text stage: its state, and today's new text time after a first round (PRD §7.4, §10.5).
      if (result.text) {
        const { state, track, newSec } = result.text;
        const data = textStateRow(state);
        await tx.textState.upsert({
          where: { user_id_text_id_track: { user_id: user.id, text_id: state.textId, track } },
          create: { user_id: user.id, text_id: state.textId, track, ...data },
          update: data,
        });
        if (newSec > 0) await addDaily(tx, who, today, track === "listening" ? { new_text_sec_listening: newSec } : { new_text_sec_reading: newSec });
      }
      // A finished phonics round: the lesson's state, the «بعداً» count from zero, and the module done
      // when every lesson is over. «بعداً» on an auto round counts; the last one allowed turns the rounds off (PRD §8.3, §8.4).
      if (result.phonics || result.phonicsLater) {
        const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { user_id_language: { user_id: user.id, language: row.language } } });
        const after = phonicsSkipsAfter(enrollment.phonics_skips, result.phonics ? "round" : "later", ctx.settings);
        let done = enrollment.phonics_done;
        if (result.phonics) {
          const { state } = result.phonics;
          const data = { rounds_done: state.roundsDone, last_score: state.lastScore, next_at: state.nextAt ? new Date(state.nextAt) : null, done: state.done };
          await tx.phonicsState.upsert({ where: { user_id_lesson_id: { user_id: user.id, lesson_id: state.lessonId } }, create: { user_id: user.id, lesson_id: state.lessonId, ...data }, update: data });
          done = phonicsProgress(ctx.content, await loadPhonicsStates(tx, user.id, row.language)).done;
        }
        const off = after.off && enrollment.phonics_auto;
        await tx.enrollment.update({
          where: { id: enrollment.id },
          data: { phonics_skips: after.skips, phonics_done: done, ...(off ? { phonics_auto: false, phonics_off_due: true } : {}) },
        });
      }
      // Speaking (PRD §8b): only its own row; nothing else of the learner changes.
      const prod = result.production;
      if (prod?.kind === "speak") {
        const data = { count: prod.state.count, correct_count: prod.state.correctCount, last_rating: prod.state.lastRating, next_at: prod.state.nextAt ? new Date(prod.state.nextAt) : null };
        await tx.speakState.upsert({ where: { user_id_sentence_id: { user_id: user.id, sentence_id: prod.sentenceId } }, create: { user_id: user.id, sentence_id: prod.sentenceId, ...data }, update: data });
      } else if (prod?.kind === "dialogue") {
        const data = { attempts_done: prod.state.attemptsDone, scores: prod.state.scores, next_attempt_at: prod.state.nextAttemptAt ? new Date(prod.state.nextAttemptAt) : null };
        await tx.dialogueState.upsert({ where: { user_id_dialogue_id: { user_id: user.id, dialogue_id: prod.dialogueId } }, create: { user_id: user.id, dialogue_id: prod.dialogueId, ...data }, update: data });
      } else if (prod?.kind === "errorfix") {
        const data = {
          attempts_done: prod.state.attemptsDone,
          results: prod.state.results as unknown as Prisma.InputJsonValue,
          next_attempt_at: prod.state.nextAttemptAt ? new Date(prod.state.nextAttemptAt) : null,
        };
        await tx.errorfixState.upsert({ where: { user_id_errorfix_item_id: { user_id: user.id, errorfix_item_id: prod.itemId } }, create: { user_id: user.id, errorfix_item_id: prod.itemId, ...data }, update: data });
      }
      // The placement sample (PRD §11.4): its count, and what a failure changes.
      if (result.sample) await recordSample(tx, user.id, row.language, result.sample, ctx);
      // «کلمه‌های این متن»: its words wait in the queue (PRD §7.5, source `key_word`).
      if (result.keyWords.length > 0) {
        const taken = new Set(
          (await tx.itemState.findMany({ where: { user_id: user.id, item_type: "word", item_id: { in: result.keyWords } }, select: { item_id: true } })).map((item) => item.item_id),
        );
        const rows = result.keyWords.filter((id) => !taken.has(id)).map((id) => ({ user_id: user.id, language: row.language, word_id: id, source: "key_word" as const, added_at: at }));
        if (rows.length > 0) await tx.newWordQueue.createMany({ data: rows, skipDuplicates: true });
      }
      if (card.t === "confusion" && card.pair) {
        const [a, b] = card.pair[0] < card.pair[1] ? card.pair : [card.pair[1], card.pair[0]];
        await tx.confusionPair.updateMany({ where: { user_id: user.id, word_id: a, other_word_id: b }, data: { card_shown_at: at } });
      }

      // A standard word that first reaches step 4 queues its colloquial words (PRD §5.4).
      if (result.single && card.item.startsWith("w:")) {
        const word = ctx.content.words.get(parseItemKey(card.item).id);
        const extra = word ? colloquialFor(ctx.content, word, result.single.stepBefore, result.single.stepAfter, ctx.settings) : [];
        if (extra.length > 0) {
          const taken = new Set(
            (await tx.itemState.findMany({ where: { user_id: user.id, item_type: "word", item_id: { in: extra.map((item) => item.id) } }, select: { item_id: true } })).map(
              (item) => item.item_id,
            ),
          );
          const rows = extra
            .filter((item) => !taken.has(item.id))
            .map((item) => ({ user_id: user.id, language: row.language, word_id: item.id, source: "colloquial" as const, added_at: at }));
          if (rows.length > 0) await tx.newWordQueue.createMany({ data: rows, skipDuplicates: true });
        }
      }

      const next = result.advanced.plan;
      const stored: StoredPlan = { ...next, start: plan.start };
      await tx.session.update({
        where: { id: row.id },
        data: { plan: stored as unknown as Prisma.InputJsonValue, position: next.doneCount, next_seq: row.next_seq + 1, last_answer_at: at },
      });
      if (!result.advanced.finished) return { kind: "ok", seq: request.seq, finished: false, end: null };
      const end = await finishSession(tx, { ...row, plan: stored as unknown as Prisma.JsonValue, next_seq: row.next_seq + 1, last_answer_at: at }, stored, ctx, at);
      return { kind: "ok", seq: request.seq, finished: true, end };
    },
    { timeout: 20_000 },
  );
  if (noted.mismatch) await logError("session.answer", new Error(noted.mismatch), { userId: user.id, requestId: request.answerId });
  return response;
}

/** The end screen of a finished session, for a reload after the last answer (PRD §15.4, step 8). */
export async function sessionEnd(user: Learner, sessionId: string): Promise<EndSummary | null> {
  const row = await db.session.findUnique({ where: { id: sessionId }, select: { user_id: true, plan: true, end_reason: true } });
  if (!row || row.user_id !== user.id || row.end_reason !== "finished") return null;
  return (row.plan as unknown as StoredPlan).end ?? null;
}
