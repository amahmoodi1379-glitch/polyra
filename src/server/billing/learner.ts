import { num } from "@/engine/settings";
import { db } from "@/server/db";
import { engineSettings } from "@/server/settings/read";
import { getGateway } from "./gateway";
import { canFollowUp } from "./orders";

/**
 * What the learner sees of sales (PRD §3.8, §12.4): the plans of a language, and «اشتراک من» with the
 * end of each language's access and every order, with «پیگیری پرداخت» on recent unpaid ones.
 */

export type PlanCard = { id: number; name: string; days: number; price: number; badge: string | null };

export async function activePlans(language: string): Promise<PlanCard[]> {
  const plans = await db.plan.findMany({ where: { language, active: true }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] });
  return plans.map((plan) => ({ id: plan.id, name: plan.name_fa, days: plan.duration_days, price: plan.price_toman, badge: plan.badge_fa }));
}

/** Whether the gateway is the test one, so the page can say nothing is charged. */
export const gatewayIsMock = () => getGateway().isMock;

export type MyOrder = {
  id: number;
  createdAt: Date;
  language: string;
  plan: string | null;
  amount: number;
  status: "pending" | "paid" | "failed" | "expired";
  ref: string | null;
  followUp: boolean;
};

export type MyAccess = { language: string; trialEndsAt: Date | null; trialStarted: boolean; subscriptionEndsAt: Date | null };

export async function mySubscription(userId: number, now = new Date()): Promise<{ languages: MyAccess[]; orders: MyOrder[] }> {
  const [enrollments, subscriptions, orders, settings] = await Promise.all([
    db.enrollment.findMany({ where: { user_id: userId }, orderBy: { created_at: "asc" }, select: { language: true, trial_started_at: true, trial_ends_at: true } }),
    db.subscription.groupBy({ by: ["language"], where: { user_id: userId }, _max: { ends_at: true } }),
    db.order.findMany({ where: { user_id: userId }, orderBy: { created_at: "desc" }, take: 50 }),
    engineSettings(),
  ]);
  const plans = new Map((await db.plan.findMany({ where: { id: { in: [...new Set(orders.map((order) => order.plan_id))] } }, select: { id: true, name_fa: true } })).map((plan) => [plan.id, plan.name_fa]));
  const ends = new Map(subscriptions.map((row) => [row.language, row._max.ends_at]));
  const hours = num(settings, "order.followup_hours");
  return {
    languages: enrollments.map((row) => ({ language: row.language, trialStarted: !!row.trial_started_at, trialEndsAt: row.trial_ends_at, subscriptionEndsAt: ends.get(row.language) ?? null })),
    orders: orders.map((order) => ({
      id: order.id,
      createdAt: order.created_at,
      language: order.language,
      plan: plans.get(order.plan_id) ?? null,
      amount: order.final_amount,
      status: order.status,
      ref: order.gateway_ref,
      followUp: canFollowUp(order, hours, now),
    })),
  };
}
