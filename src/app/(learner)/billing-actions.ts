"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { followUpMine, quote, startOrder, type FollowUp } from "@/server/billing/orders";
import type { CodeRefusal } from "@/server/billing/discounts";
import { db } from "@/server/db";
import { siteOrigin } from "@/server/origin";

/** The learner's side of buying (PRD §12.4): a price with a code, «پرداخت», and «پیگیری پرداخت». */

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type PriceAnswer = { ok: true; price: number; off: number; final: number } | { ok: false; reason: "gone" | CodeRefusal };

/** The price shown the moment a code is typed (PRD §12.4 step 1); the order is priced again on the server. */
export async function priceWithCode(planId: number, code: string): Promise<PriceAnswer> {
  const user = await signedIn();
  if (!Number.isInteger(planId)) return { ok: false, reason: "gone" };
  const priced = await quote(db, user.id, planId, code, new Date());
  if (!priced.ok) return { ok: false, reason: priced.reason === "plan" ? "gone" : priced.code };
  return { ok: true, price: priced.price, off: priced.off, final: priced.final };
}

export type PayAnswer = { kind: "go"; url: string } | { kind: "free"; language: string; orderId: number } | { kind: "refused"; reason: "gone" | CodeRefusal } | { kind: "gateway" };

/** «پرداخت»: the gateway's page, or straight to «اشتراک من» when a code made it free. */
export async function payForPlan(planId: number, code: string): Promise<PayAnswer> {
  const user = await signedIn();
  if (!Number.isInteger(planId)) return { kind: "refused", reason: "gone" };
  const origin = await siteOrigin();
  const result = await startOrder({ id: user.id, phone: user.phone }, planId, code, `${origin}/pay/return`);
  if (result.kind === "redirect") return { kind: "go", url: result.url };
  if (result.kind === "free") {
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId }, select: { language: true } });
    return { kind: "free", language: order.language, orderId: result.orderId };
  }
  if (result.kind === "refused") return { kind: "refused", reason: result.quote.reason === "plan" ? "gone" : result.quote.code };
  return { kind: "gateway" };
}

/** «پیگیری پرداخت» on one of the learner's own orders. */
export async function followUpPayment(orderId: number): Promise<FollowUp> {
  const user = await signedIn();
  if (!Number.isInteger(orderId)) return "gone";
  return followUpMine(user.id, orderId);
}
