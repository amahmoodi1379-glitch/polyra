import type { ContentReport, Prisma, ReviewLog } from "@/generated/prisma/client";
import { exerciseDef } from "@/engine/exercises";
import { answerWasCounted, notebookRefOf, rightAfterAll } from "@/engine/report";
import { changeStatus } from "@/server/content/library/status";
import { targetColumns } from "@/server/content/library/edit/sentences";
import { logEdit } from "@/server/content/library/edit/shared";
import { db } from "@/server/db";
import { forgetContent } from "@/server/learn/content";
import { reportSlug } from "./slugs";

/**
 * «گزارش اشکال» in the panel (PRD §13.10): the queue, and the four answers to a report. «جواب کاربر هم
 * درست است» adds the learner's answer to what the exercise accepts (a single-blank typed sentence, the
 * order of a sentence, a transform or a translation); with «محتوا را اصلاح کن» the teacher says whether
 * the learner was right. Either way a learner who was right gets «حق با تو بود» (`rightAfterAll`).
 */

type Tx = Prisma.TransactionClient;

/** Where an accepted answer goes: a target's blank, a target's whole-sentence orders, or a transform or translation's outputs. */
export type AcceptPlace =
  | { kind: "blank"; targetId: number }
  | { kind: "order"; targetId: number }
  | { kind: "transform"; itemId: number }
  | { kind: "translate"; itemId: number };

const ORDER_CODES = new Set(["G4a", "G4b"]);

/** Whether «جواب کاربر هم درست است» can apply: a typed or ordered answer with a list of accepted answers to add to (PRD §13.10). */
export function acceptPlace(report: Pick<ContentReport, "item_type" | "item_id" | "exercise_code" | "raw_answer">, log: Pick<ReviewLog, "sentence_target_id"> | null): AcceptPlace | null {
  if (!report.raw_answer?.trim() || !report.exercise_code) return null;
  if (report.item_type === "transform_item") return { kind: "transform", itemId: report.item_id };
  if (report.item_type === "translate_item") return { kind: "translate", itemId: report.item_id };
  const targetId = log?.sentence_target_id ?? null;
  if (targetId === null) return null;
  if (ORDER_CODES.has(report.exercise_code)) return { kind: "order", targetId };
  let typed = false;
  try {
    typed = exerciseDef(report.exercise_code).typed;
  } catch {
    return null;
  }
  return typed ? { kind: "blank", targetId } : null;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** Adds one answer to the list it belongs in, logged like an edit of that item; false when it was already there. */
async function addAccepted(tx: Tx, adminId: number, place: AcceptPlace, answer: string): Promise<boolean> {
  const value = answer.trim();
  if (place.kind === "transform" || place.kind === "translate") {
    const row =
      place.kind === "transform"
        ? await tx.transformItem.findUnique({ where: { id: place.itemId }, select: { accepted_outputs: true } })
        : await tx.translateItem.findUnique({ where: { id: place.itemId }, select: { accepted_outputs: true } });
    if (!row) throw new Error(`No ${place.kind} ${place.itemId}`);
    if (row.accepted_outputs.some((item) => same(item, value))) return false;
    const next = [...row.accepted_outputs, value];
    await logEdit(tx, adminId, place.kind === "transform" ? "transforms" : "translations", place.itemId, { accepted_outputs: row.accepted_outputs }, { accepted_outputs: next });
    if (place.kind === "transform") await tx.transformItem.update({ where: { id: place.itemId }, data: { accepted_outputs: next } });
    else await tx.translateItem.update({ where: { id: place.itemId }, data: { accepted_outputs: next } });
    return true;
  }
  const target = await tx.sentenceTarget.findUniqueOrThrow({ where: { id: place.targetId } });
  const field = place.kind === "blank" ? "accepted" : "accepted_full";
  const list = Array.isArray(target[field]) ? (target[field] as unknown[]).map(String) : [];
  if (place.kind === "blank" && target.blanks !== 1) throw new Error(`Target ${target.id} has ${target.blanks} blanks`);
  if (list.some((item) => same(item, value))) return false;
  const next = [...list, value];
  const before = targetColumns(target);
  await logEdit(tx, adminId, "sentences", target.sentence_id, {}, {}, { before: { sentence_target: [before] }, after: { sentence_target: [{ ...before, [field]: next }] } });
  await tx.sentenceTarget.update({ where: { id: target.id }, data: { [field]: next } });
  return true;
}

/**
 * «حق با تو بود» for the one learner who reported (PRD §13.10), only for an answer recorded as wrong or
 * «نمی‌دانم»: the notebook entry it made goes, the step goes back to the larger of now and before, one
 * failure fewer, FSRS untouched, and a note waits on their home. True when it was applied.
 */
async function rightAfterAllFor(tx: Tx, report: ContentReport, log: ReviewLog | null, now: Date): Promise<boolean> {
  if (!report.user_id || !log || log.user_id !== report.user_id) return false;
  const result = log.result;
  if (result !== "correct" && result !== "near" && result !== "wrong" && result !== "idk") return false;
  const answer = { itemType: log.item_type, itemId: log.item_id, code: log.exercise_code, targetId: log.sentence_target_id, stepBefore: log.step_before, result };
  if (!answerWasCounted(answer)) return false;
  const ref = notebookRefOf(answer);
  if (ref) await tx.notebookEntry.deleteMany({ where: { user_id: report.user_id, language: log.language, ref_type: ref.refType, ref_id: ref.refId } });
  if ((log.item_type === "word" || log.item_type === "grammar_unit" || log.item_type === "conjugation") && log.item_id !== null) {
    const state = await tx.itemState.findUnique({ where: { user_id_item_type_item_id: { user_id: report.user_id, item_type: log.item_type, item_id: log.item_id } } });
    if (state) {
      const next = rightAfterAll({ step: state.step, failCount: state.fail_count }, log.step_before);
      await tx.itemState.update({ where: { id: state.id }, data: { step: next.step, fail_count: next.failCount } });
    }
  }
  await tx.userNotice.create({ data: { user_id: report.user_id, language: log.language, kind: "report_fixed", payload: { report: report.id }, created_at: now } });
  return true;
}

export type ReportAction = { ok: true; right: boolean } | { ok: false; reason: "gone" | "closed" | "cannot" };

async function openReport(tx: Tx, id: number) {
  await tx.$queryRaw`SELECT id FROM "content_report" WHERE id = ${id} FOR UPDATE`;
  const report = await tx.contentReport.findUnique({ where: { id } });
  const log = report?.review_log_id ? await tx.reviewLog.findUnique({ where: { id: report.review_log_id } }) : null;
  return { report, log };
}

/** «جواب کاربر هم درست است»: the answer joins the accepted ones, the report is fixed, and the learner hears they were right. */
export async function acceptAnswer(adminId: number, id: number, now = new Date()): Promise<ReportAction> {
  const reply = await db.$transaction(async (tx): Promise<ReportAction> => {
    const { report, log } = await openReport(tx, id);
    if (!report) return { ok: false, reason: "gone" };
    if (report.status !== "open") return { ok: false, reason: "closed" };
    const place = acceptPlace(report, log);
    if (!place) return { ok: false, reason: "cannot" };
    await addAccepted(tx, adminId, place, report.raw_answer!);
    await tx.contentReport.update({ where: { id }, data: { status: "fixed", resolved_by: adminId } });
    return { ok: true, right: await rightAfterAllFor(tx, report, log, now) };
  });
  if (reply.ok) forgetContent();
  return reply;
}

/** After «محتوا را اصلاح کن»: fixed, with «حق با تو بود» when the teacher ticks that the learner was right. */
export async function markFixed(adminId: number, id: number, learnerWasRight: boolean, now = new Date()): Promise<ReportAction> {
  return db.$transaction(async (tx): Promise<ReportAction> => {
    const { report, log } = await openReport(tx, id);
    if (!report) return { ok: false, reason: "gone" };
    if (report.status !== "open") return { ok: false, reason: "closed" };
    await tx.contentReport.update({ where: { id }, data: { status: "fixed", resolved_by: adminId } });
    return { ok: true, right: learnerWasRight ? await rightAfterAllFor(tx, report, log, now) : false };
  });
}

/** «رد گزارش». */
export async function rejectReport(adminId: number, id: number): Promise<ReportAction> {
  const { count } = await db.contentReport.updateMany({ where: { id, status: "open" }, data: { status: "rejected", resolved_by: adminId } });
  if (count > 0) return { ok: true, right: false };
  return (await db.contentReport.findUnique({ where: { id }, select: { id: true } })) ? { ok: false, reason: "closed" } : { ok: false, reason: "gone" };
}

/** «فوری» or back to normal by hand (PRD §13.10). */
export async function setReportPriority(id: number, priority: "normal" | "high") {
  await db.contentReport.updateMany({ where: { id, status: "open" }, data: { priority } });
}

/**
 * «تعلیق» (PRD §13.10): out of the next sessions at once, until it is fixed. A report about a sentence
 * suspends the sentence, not the whole word or unit; the report stays open.
 */
export async function suspendReported(adminId: number, id: number): Promise<ReportAction> {
  const report = await db.contentReport.findUnique({ where: { id } });
  if (!report) return { ok: false, reason: "gone" };
  const log = report.review_log_id ? await db.reviewLog.findUnique({ where: { id: report.review_log_id }, select: { language: true } }) : null;
  const target = report.sentence_id !== null && !["transform_item", "translate_item"].includes(report.item_type) ? { slug: "sentences" as const, id: report.sentence_id } : { slug: reportSlug[report.item_type], id: report.item_id };
  if (!target.slug || !log) return { ok: false, reason: "cannot" };
  const result = await changeStatus(target.slug, log.language, [target.id], "suspend", adminId);
  if (result.refused.length > 0) return { ok: false, reason: "cannot" };
  if (result.changed + result.unchanged === 0) return { ok: false, reason: "gone" };
  forgetContent();
  return { ok: true, right: false };
}
