import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * Who may practise a language (PRD §12.5) and the free period that starts when the first session of
 * a language closes (PRD §12.1).
 */

type Client = Prisma.TransactionClient | typeof db;

/** The phone number as the trial ledger keeps it: a hash, so the number itself can be deleted (PRD §15.5). */
export const phoneHash = (phone: string) => createHash("sha256").update(`polyra-trial:${phone}`).digest("hex");

export async function canPractice(
  client: Client,
  user: { id: number; is_admin: boolean; is_tester: boolean },
  enrollment: { language: string; trial_started_at: Date | null; trial_ends_at: Date | null },
  now: Date,
): Promise<boolean> {
  if (user.is_admin || user.is_tester) return true;
  if (!enrollment.trial_started_at) return true;
  if (enrollment.trial_ends_at && now < enrollment.trial_ends_at) return true;
  const active = await client.subscription.findFirst({ where: { user_id: user.id, language: enrollment.language, ends_at: { gt: now } }, select: { id: true } });
  return !!active;
}

/** Starts the free period of a language when its first session closes (PRD §12.1). */
export async function startTrialIfFirst(tx: Prisma.TransactionClient, userId: number, language: string, now: Date, hours: number) {
  const enrollment = await tx.enrollment.findUnique({ where: { user_id_language: { user_id: userId, language } }, select: { id: true, trial_started_at: true } });
  if (!enrollment || enrollment.trial_started_at) return;
  await tx.enrollment.update({ where: { id: enrollment.id }, data: { trial_started_at: now, trial_ends_at: new Date(now.getTime() + hours * 3_600_000) } });
  const user = await tx.user.findUnique({ where: { id: userId }, select: { phone: true } });
  if (user?.phone) {
    await tx.trialLedger.upsert({
      where: { phone_hash_language: { phone_hash: phoneHash(user.phone), language } },
      create: { phone_hash: phoneHash(user.phone), language, started_at: now },
      update: {},
    });
  }
}
