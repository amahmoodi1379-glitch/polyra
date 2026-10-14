import { z } from "zod";
import type { RawAnswer } from "@/engine/ex";
import { colloquialFor } from "@/engine/session/newmaterial";
import { playCard } from "@/engine/session/play";
import { num } from "@/engine/settings";
import { parseItemKey } from "@/engine/state";
import { tehranDate } from "@/engine/time";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { logError } from "@/server/errors";
import { finishSession } from "./finish";
import { bundleOf, closeSession, expiresAt, learnContext, type Bundle, type EndSummary, type Learner, type StoredPlan } from "./session";
import { addDaily, applyNotebookOps, saveConfusion, saveItemState, type DailyAdd } from "./writes";

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
});
export type AnswerRequest = z.infer<typeof answerSchema>;

export type AnswerResponse =
  | { kind: "ok"; seq: number; finished: boolean; end: EndSummary | null }
  | { kind: "duplicate" }
  | { kind: "resync"; bundle: Bundle }
  | { kind: "gone" }
  | { kind: "invalid" };

/** Answers older than this after the session's build are dropped (PRD §15.4, step 9). */
const LATE_MS = 24 * 3_600_000;

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
      if (row.ended_at || serverNow.getTime() - row.created_at.getTime() > LATE_MS) return { kind: "gone" };
      if (at >= expiresAt(row, ctx.settings)) {
        await closeSession(row, "expired", expiresAt(row, ctx.settings), ctx, tx);
        return { kind: "gone" };
      }
      const plan = row.plan as unknown as StoredPlan;
      if (request.seq !== row.next_seq || plan.queue[0]?.id !== request.cardId) return { kind: "resync", bundle: bundleOf(row, ctx, false) };

      const today = tehranDate(at);
      const lexicon = ctx.content.lemmaIndex;
      const result = playCard(
        plan,
        request.cardId,
        request.answer as RawAnswer,
        { latencyMs: request.latencyMs, elapsedSec: request.elapsedSec },
        { ctx: { settings: ctx.settings, now: at, today, latency: plan.latency }, language: ctx.content.language, wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] },
      );
      // The browser sends only final answers; a synonym or Persian letters never reach the server.
      if (!result.done) return { kind: "invalid" };
      const server = result.graded?.result ?? "seen";
      if (request.shown && request.shown !== server) noted.mismatch = `The browser showed ${request.shown}, the server graded ${server} (card ${request.cardId})`;

      const who = { userId: user.id, language: row.language };
      const { log, card } = result;
      await tx.reviewLog.create({
        data: {
          id: request.answerId,
          user_id: user.id,
          language: row.language,
          session_id: row.id,
          kind: log.kind,
          item_type: log.itemType,
          item_id: log.itemId,
          exercise_code: log.code,
          step_before: log.stepBefore,
          step_after: log.stepAfter,
          sentence_id: log.sentenceId,
          sentence_target_id: log.targetId,
          result: log.result,
          result_reason: log.reason,
          raw_answer: log.raw,
          chosen_word_id: log.chosenWordId,
          first_typing: log.firstTyping,
          latency_ms: Math.round(request.latencyMs),
          fsrs_rating: log.rating,
          seq: request.seq,
          ts: at,
        },
      });

      // Active learning (PRD §3.9): every answer and every intro card or lesson, each up to a minute.
      const add: DailyAdd = { active_sec: Math.round(Math.min(request.latencyMs / 1000, num(ctx.settings, "active.cap_sec"))) };
      for (const state of [result.state, result.roundState]) {
        if (!state) continue;
        const isNew = await saveItemState(tx, who, state);
        if (!isNew) continue;
        if (state.itemType === "word") {
          add.new_words = (add.new_words ?? 0) + 1;
          const queued = await tx.newWordQueue.deleteMany({ where: { user_id: user.id, word_id: state.itemId } });
          if (queued.count > 0) add.queue_words = (add.queue_words ?? 0) + 1;
        } else if (state.itemType === "grammar_unit") add.new_units = (add.new_units ?? 0) + 1;
        else add.new_conj = (add.new_conj ?? 0) + 1;
      }
      await addDaily(tx, who, today, add);
      await applyNotebookOps(tx, who, result.notebook, at, today, ctx.settings);
      if (result.pair) await saveConfusion(tx, who, result.pair);
      if (card.t === "confusion" && card.pair) {
        const [a, b] = card.pair[0] < card.pair[1] ? card.pair : [card.pair[1], card.pair[0]];
        await tx.confusionPair.updateMany({ where: { user_id: user.id, word_id: a, other_word_id: b }, data: { card_shown_at: at } });
      }

      // A standard word that first reaches step 4 queues its colloquial words (PRD §5.4).
      if (result.single && card.item.startsWith("w:")) {
        const word = ctx.content.words.get(parseItemKey(card.item).id);
        const extra = word ? colloquialFor(ctx.content, word, result.single.stepBefore, result.single.stepAfter) : [];
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
