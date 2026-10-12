"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { t, type MessageKey } from "@/i18n";
import { requireAdmin } from "@/server/auth/session";
import {
  cancelBatch,
  cutAnswer,
  dismissRejected,
  resetCut,
  setChatbot,
  submitAnswer,
  submitQa,
  type SubmitResult,
} from "@/server/content/batches";
import { db } from "@/server/db";
import { logError } from "@/server/errors";

export type PasteOutcome = { ok: true; cut?: boolean } | { ok: false; message: string };

const failure: Record<Exclude<SubmitResult["state"], "imported" | "cut">, MessageKey> = {
  empty: "admin.batch.paste.empty",
  broken: "admin.batch.paste.broken",
  wrong_answer: "admin.batch.paste.wrongAnswer",
};

function outcome(result: SubmitResult): PasteOutcome {
  if (result.state === "imported") return { ok: true };
  if (result.state === "cut") return { ok: true, cut: true };
  return { ok: false, message: t(failure[result.state]) };
}

const refresh = (batchId: number) => revalidatePath(`/admin/batches/${batchId}`);

/** The chatbot is saved when the prompt is copied, and again with the answer if it changed. */
export async function chooseChatbot(batchId: number, name: string) {
  await requireAdmin();
  if (await setChatbot(batchId, name)) refresh(batchId);
}

/**
 * Step 2 (and the fix in step 3). A paste that follows a cut answer is its continuation, so the
 * part already received is put in front of it here rather than sent back from the page.
 */
export async function pasteAnswer(batchId: number, input: { text: string; mode: "answer" | "fix"; chatbot: string }) {
  const admin = await requireAdmin();
  try {
    if (input.chatbot) await setChatbot(batchId, input.chatbot);
    const before = input.mode === "answer" ? await cutAnswer(batchId) : null;
    const result = await submitAnswer(batchId, before ? [before, input.text] : [input.text], input.mode);
    refresh(batchId);
    return outcome(result);
  } catch (error) {
    const code = await logError("batch.pasteAnswer", error, { userId: admin.id });
    return { ok: false, message: t("errors.withCode", { code }) } satisfies PasteOutcome;
  }
}

/** Step 4: the QA chatbot's findings. */
export async function pasteQa(batchId: number, text: string): Promise<PasteOutcome> {
  const admin = await requireAdmin();
  try {
    const result = await submitQa(batchId, [text]);
    refresh(batchId);
    return outcome(result);
  } catch (error) {
    const code = await logError("batch.pasteQa", error, { userId: admin.id });
    return { ok: false, message: t("errors.withCode", { code }) };
  }
}

export async function startOver(batchId: number) {
  await requireAdmin();
  await resetCut(batchId);
  refresh(batchId);
}

export async function skipRejected(batchId: number) {
  await requireAdmin();
  await dismissRejected(batchId);
  refresh(batchId);
}

export async function throwAway(batchId: number) {
  const admin = await requireAdmin();
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { language: true } });
  if (!batch) redirect("/admin/create");
  try {
    await cancelBatch(batchId);
  } catch (error) {
    await logError("batch.cancel", error, { userId: admin.id });
  }
  redirect(`/admin/create?lang=${batch.language}`);
}
