import type { ReportReason } from "@/generated/prisma/client";
import { num } from "@/engine/settings";
import { tehranDate, tehranDayStart } from "@/engine/time";
import { db } from "@/server/db";
import { engineSettings } from "@/server/settings/read";

/**
 * «گزارش اشکال» from the feedback sheet of an exercise (PRD §13.10). The answer it is about must already
 * be on the server (its `review_log` row, by the id the browser gave it): the item, the exercise, the
 * sentence and the learner's own answer are read from there, never from the browser. A transform or a
 * translation (G6, G6b) is found by its text inside the unit the answer was about.
 */

export const REPORT_REASONS = ["my_answer_ok", "answer_wrong", "audio", "translation", "other"] as const satisfies readonly ReportReason[];
/** A note is one line (PRD §13.10). */
export const REPORT_NOTE_MAX = 300;
/** Enough for a real day of finding mistakes, too few to flood the queue. */
export const REPORTS_PER_DAY = 30;

export type ReportInput = { answerId: unknown; reason: unknown; note?: unknown; source?: unknown; promptFa?: unknown };
export type ReportReply = { ok: true } | { ok: false; reason: "invalid" | "later" | "limit" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");

/** The content item a report points at: the transform or translation of a G6/G6b, a notebook sentence's unit or word, or the answer's own item. */
async function reportedItem(log: { item_type: string | null; item_id: number | null; exercise_code: string | null }, source: string, promptFa: string) {
  if (log.item_type === "grammar_unit" && log.item_id !== null) {
    if (log.exercise_code === "G6" && source) {
      const row = await db.transformItem.findFirst({ where: { grammar_unit_id: log.item_id, source_sentence: source }, select: { id: true } });
      if (row) return { type: "transform_item", id: row.id };
    }
    if (log.exercise_code === "G6b" && promptFa) {
      const row = await db.translateItem.findFirst({ where: { grammar_unit_id: log.item_id, prompt_fa: promptFa }, select: { id: true } });
      if (row) return { type: "translate_item", id: row.id };
    }
  }
  if (log.item_type === "grammar_target" && log.item_id !== null) {
    const target = await db.sentenceTarget.findUnique({ where: { id: log.item_id }, select: { target_type: true, target_id: true } });
    if (!target) return null;
    return { type: target.target_type === "grammar" ? "grammar_unit" : "word", id: target.target_id };
  }
  if (!log.item_type || log.item_id === null) return null;
  return { type: log.item_type, id: log.item_id };
}

export async function fileReport(user: { id: number }, input: ReportInput, now = new Date()): Promise<ReportReply> {
  const answerId = text(input.answerId);
  const reason = text(input.reason) as ReportReason;
  const note = text(input.note).replace(/\s+/g, " ");
  if (!UUID.test(answerId) || !(REPORT_REASONS as readonly string[]).includes(reason) || note.length > REPORT_NOTE_MAX) return { ok: false, reason: "invalid" };

  // The answer may still be on its way (a weak connection): the browser asks again a little later.
  const log = await db.reviewLog.findUnique({ where: { id: answerId } });
  if (!log) return { ok: false, reason: "later" };
  if (log.user_id !== user.id) return { ok: false, reason: "invalid" };
  if (await db.contentReport.findFirst({ where: { review_log_id: answerId, user_id: user.id }, select: { id: true } })) return { ok: true };

  const today = await db.contentReport.count({ where: { user_id: user.id, created_at: { gte: tehranDayStart(tehranDate(now)) } } });
  if (today >= REPORTS_PER_DAY) return { ok: false, reason: "limit" };

  const item = await reportedItem(log, text(input.source), text(input.promptFa));
  if (!item) return { ok: false, reason: "invalid" };

  const settings = await engineSettings();
  await db.$transaction(async (tx) => {
    await tx.contentReport.create({
      data: {
        user_id: user.id,
        review_log_id: answerId,
        item_type: item.type,
        item_id: item.id,
        exercise_code: log.exercise_code,
        sentence_id: log.sentence_id,
        reason,
        raw_answer: log.raw_answer,
        note: note || null,
        created_at: now,
      },
    });
    // Three different people on one item: «بالا», which holds back its level's release (PRD §13.5).
    const people = await tx.contentReport.findMany({ where: { item_type: item.type, item_id: item.id, status: "open", user_id: { not: null } }, distinct: ["user_id"], select: { user_id: true } });
    if (people.length >= num(settings, "report.auto_high")) {
      await tx.contentReport.updateMany({ where: { item_type: item.type, item_id: item.id, status: "open", priority: "normal" }, data: { priority: "high" } });
    }
    await tx.event.create({ data: { user_id: user.id, language: log.language, name: "report", props: { reason, code: log.exercise_code }, ts: now } });
  });
  return { ok: true };
}

/** «حق با تو بود» notes waiting on this language's home, marked seen as they are shown. */
export async function takeReportNotices(userId: number, language: string, now = new Date()): Promise<number> {
  const waiting = await db.userNotice.findMany({ where: { user_id: userId, language, kind: "report_fixed", seen_at: null }, select: { id: true } });
  if (waiting.length === 0) return 0;
  await db.userNotice.updateMany({ where: { id: { in: waiting.map((row) => row.id) } }, data: { seen_at: now } });
  return waiting.length;
}
