import type { Prisma, SubscriptionSource } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * Subscriptions of one language (PRD §12.2): a purchase or a grant adds `duration_days` after the
 * latest of now, the language's free period and its current subscription, so buying early never loses a
 * day. A teacher can shorten or cancel what is left (PRD §12.3, for a manual refund).
 */

type Client = Prisma.TransactionClient | typeof db;
const DAY_MS = 86_400_000;

/** When the language's access currently ends: the later of the free period and every subscription. */
export async function accessEnd(client: Client, userId: number, language: string): Promise<{ trialEnd: Date | null; subscriptionEnd: Date | null }> {
  const [enrollment, latest] = await Promise.all([
    client.enrollment.findUnique({ where: { user_id_language: { user_id: userId, language } }, select: { trial_ends_at: true } }),
    client.subscription.findFirst({ where: { user_id: userId, language }, orderBy: { ends_at: "desc" }, select: { ends_at: true } }),
  ]);
  return { trialEnd: enrollment?.trial_ends_at ?? null, subscriptionEnd: latest?.ends_at ?? null };
}

export type Extend = {
  userId: number;
  language: string;
  days: number;
  now: Date;
  source: SubscriptionSource;
  planId?: number | null;
  orderId?: number | null;
  grantedBy?: number | null;
  note?: string | null;
};

/** Adds days of access (PRD §12.2 «قاعده اعتبار»): `ends_at = max(now, trial_ends_at, ends_at) + days`. */
export async function extendAccess(tx: Prisma.TransactionClient, input: Extend) {
  const { trialEnd, subscriptionEnd } = await accessEnd(tx, input.userId, input.language);
  const base = new Date(Math.max(input.now.getTime(), trialEnd?.getTime() ?? 0, subscriptionEnd?.getTime() ?? 0));
  return tx.subscription.create({
    data: {
      user_id: input.userId,
      language: input.language,
      plan_id: input.planId ?? null,
      starts_at: base,
      ends_at: new Date(base.getTime() + input.days * DAY_MS),
      source: input.source,
      order_id: input.orderId ?? null,
      granted_by: input.grantedBy ?? null,
      note: input.note ?? null,
    },
  });
}

/**
 * Takes days off what is left of a language's subscriptions, from the last one back; at zero days or
 * with `days` null, cancels everything left. The free period is not touched. Returns the rows changed,
 * as before and after, for the change log.
 */
export async function shortenAccess(tx: Prisma.TransactionClient, userId: number, language: string, days: number | null, now: Date) {
  const rows = await tx.subscription.findMany({ where: { user_id: userId, language, ends_at: { gt: now } }, orderBy: { ends_at: "desc" } });
  let cut = days === null ? Infinity : days * DAY_MS;
  const changed: { id: number; before: { starts_at: Date; ends_at: Date }; after: { starts_at: Date; ends_at: Date } }[] = [];
  for (const row of rows) {
    if (cut <= 0) break;
    const start = Math.max(row.starts_at.getTime(), now.getTime());
    const left = row.ends_at.getTime() - start;
    const take = Math.min(cut, left);
    cut -= take;
    // A row used up ends now (one that had not started yet starts now too), so it no longer counts as active.
    const after =
      take >= left
        ? { starts_at: new Date(Math.min(row.starts_at.getTime(), now.getTime())), ends_at: now }
        : { starts_at: row.starts_at, ends_at: new Date(row.ends_at.getTime() - take) };
    await tx.subscription.update({ where: { id: row.id }, data: after });
    changed.push({ id: row.id, before: { starts_at: row.starts_at, ends_at: row.ends_at }, after });
  }
  return changed;
}

/** Separate modules (PRD §12.2) the learner's active subscriptions of a language open. */
export async function unlockedModules(client: Client, userId: number, language: string, now: Date): Promise<string[]> {
  const rows = await client.subscription.findMany({ where: { user_id: userId, language, ends_at: { gt: now }, plan_id: { not: null } }, select: { plan_id: true } });
  if (rows.length === 0) return [];
  const plans = await client.plan.findMany({ where: { id: { in: rows.map((row) => row.plan_id!) } }, select: { module_codes: true } });
  return [...new Set(plans.flatMap((plan) => plan.module_codes))].sort();
}
