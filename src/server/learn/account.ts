import type { Prisma } from "@/generated/prisma/client";
import { normalizeMobile } from "@/lib/phone";
import { logChange } from "@/server/content/library/log";
import { db } from "@/server/db";
import { phoneHash } from "./access";

/**
 * The account itself (PRD §15.5): a new phone number, and deleting the account.
 *
 * A new number keeps all progress and subscriptions; every other device is signed out and the new
 * number's hash joins `trial_ledger` for each language whose free period has started, so a number
 * cannot be swapped in and out for a second free period (PRD §12.1).
 *
 * Deleting is at once and for good: the number goes (its hash stays in the ledger), every card, state
 * and session goes, answers stay in `review_log` without a user, and orders stay as money records
 * without the number. The `user` row stays empty, marked `deleted_at`, because the orders point at it.
 */

type Tx = Prisma.TransactionClient;

export type PhoneChangeResult = { ok: true; phone: string } | { ok: false; reason: "invalid" | "same" | "taken" | "gone" };

/** Whether a number may become this account's number, before an SMS is spent on it. */
export async function phoneFree(userId: number, raw: string): Promise<PhoneChangeResult> {
  const phone = normalizeMobile(raw);
  if (!phone) return { ok: false, reason: "invalid" };
  const user = await db.user.findUnique({ where: { id: userId }, select: { phone: true, deleted_at: true } });
  if (!user || user.deleted_at) return { ok: false, reason: "gone" };
  if (user.phone === phone) return { ok: false, reason: "same" };
  const other = await db.user.findUnique({ where: { phone }, select: { id: true } });
  return other ? { ok: false, reason: "taken" } : { ok: true, phone };
}

/**
 * Moves the account to a new number. `keepDevice` is the device the learner changed it from (it stays
 * signed in); a teacher's change from «کاربران» passes null, signing every device out, and is logged.
 */
export async function changePhone(
  userId: number,
  raw: string,
  by: { keepDevice: number | null; adminId: number | null },
  now = new Date(),
): Promise<PhoneChangeResult> {
  const phone = normalizeMobile(raw);
  if (!phone) return { ok: false, reason: "invalid" };
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { phone: true, deleted_at: true } });
      if (!user || user.deleted_at) return { ok: false, reason: "gone" } as const;
      if (user.phone === phone) return { ok: false, reason: "same" } as const;
      if (await tx.user.findUnique({ where: { phone }, select: { id: true } })) return { ok: false, reason: "taken" } as const;
      await tx.user.update({ where: { id: userId }, data: { phone } });
      await tx.authDevice.deleteMany({ where: { user_id: userId, ...(by.keepDevice !== null ? { id: { not: by.keepDevice } } : {}) } });
      await ledgerStarted(tx, userId, phone, now);
      if (by.adminId !== null) {
        await logChange(tx, by.adminId, { action: "phone", entity: "user", entityId: userId, before: { phone: user.phone }, after: { phone } });
      }
      await tx.event.create({ data: { user_id: userId, name: "phone_change", props: { by: by.adminId !== null ? "admin" : "self" }, ts: now } });
      return { ok: true, phone } as const;
    });
  } catch (error) {
    // Two accounts asked for the same number at once: the unique index decides.
    if ((error as { code?: string }).code === "P2002") return { ok: false, reason: "taken" };
    throw error;
  }
}

/** The number's hash for every language whose free period has started (PRD §12.1). */
async function ledgerStarted(tx: Tx, userId: number, phone: string, now: Date) {
  const started = await tx.enrollment.findMany({ where: { user_id: userId, trial_started_at: { not: null } }, select: { language: true, trial_started_at: true } });
  const hash = phoneHash(phone);
  for (const row of started) {
    await tx.trialLedger.upsert({
      where: { phone_hash_language: { phone_hash: hash, language: row.language } },
      create: { phone_hash: hash, language: row.language, started_at: row.trial_started_at ?? now },
      update: {},
    });
  }
}

/** What the confirmation says before deleting: an active subscription is lost; a teacher cannot delete here. */
export async function deletionNotes(userId: number, now = new Date()) {
  const [user, active] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { is_admin: true } }),
    db.subscription.findMany({ where: { user_id: userId, ends_at: { gt: now } }, select: { language: true }, distinct: ["language"] }),
  ]);
  return { teacher: !!user?.is_admin, activeLanguages: active.map((row) => row.language) };
}

export type DeleteResult = { ok: true } | { ok: false; reason: "teacher" | "gone" };

/** Deletes the account (PRD §15.5). A teacher's account is not deleted here: another teacher takes the panel away first. */
export async function deleteAccount(userId: number, now = new Date()): Promise<DeleteResult> {
  return db.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { phone: true, is_admin: true, deleted_at: true } });
      if (!user || user.deleted_at) return { ok: false, reason: "gone" } as const;
      if (user.is_admin) return { ok: false, reason: "teacher" } as const;
      if (user.phone) await ledgerStarted(tx, userId, user.phone, now);

      const mine = { where: { user_id: userId } };
      await tx.authDevice.deleteMany(mine);
      await tx.itemState.deleteMany(mine);
      await tx.confusionPair.deleteMany(mine);
      await tx.textState.deleteMany(mine);
      await tx.phonicsState.deleteMany(mine);
      await tx.sentenceDrillState.deleteMany(mine);
      await tx.speakState.deleteMany(mine);
      await tx.dialogueState.deleteMany(mine);
      await tx.errorfixState.deleteMany(mine);
      await tx.writingEntry.deleteMany(mine);
      await tx.notebookEntry.deleteMany(mine);
      await tx.newWordQueue.deleteMany(mine);
      await tx.dailyCounter.deleteMany(mine);
      await tx.session.deleteMany(mine);
      await tx.placementRun.deleteMany(mine);
      await tx.levelExam.deleteMany(mine);
      await tx.userNotice.deleteMany(mine);
      await tx.skillLevel.deleteMany(mine);
      await tx.subscription.deleteMany(mine);
      await tx.enrollment.deleteMany(mine);
      // Kept without the person: answers (for «یادگیری واقعی»), reports, events and error rows.
      await tx.reviewLog.updateMany({ where: { user_id: userId }, data: { user_id: null } });
      await tx.contentReport.updateMany({ where: { user_id: userId }, data: { user_id: null } });
      await tx.event.updateMany({ where: { user_id: userId }, data: { user_id: null } });
      await tx.errorLog.updateMany({ where: { user_id: userId }, data: { user_id: null } });
      if (user.phone) await tx.otpCode.deleteMany({ where: { phone: user.phone } });
      await tx.user.update({ where: { id: userId }, data: { phone: null, deleted_at: now, is_tester: false } });
      await tx.event.create({ data: { name: "account_delete", ts: now } });
      return { ok: true } as const;
    },
    { timeout: 30_000 },
  );
}
