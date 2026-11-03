import type { Order, Plan, Prisma } from "@/generated/prisma/client";
import { num } from "@/engine/settings";
import { db } from "@/server/db";
import { engineSettings } from "@/server/settings/read";
import { checkCode, type CodeRefusal } from "./discounts";
import { getGateway, type PaymentGateway } from "./gateway";
import { extendAccess } from "./subscriptions";

/**
 * Buying a plan (PRD §12.4): the server prices the order itself (plan and code from the database, never
 * from the browser), sends the learner to the gateway, and makes the subscription only after the
 * gateway's own verify says paid. A payment is applied once, however often its return address is opened
 * (T43). An order the learner never came back from is asked about once before it expires (T77), and
 * «پیگیری پرداخت» asks again for a day.
 */

type Client = Prisma.TransactionClient | typeof db;
type Buyer = { id: number; phone: string | null };

export type Quote =
  | { ok: true; plan: Plan; price: number; off: number; final: number; code: string | null }
  | { ok: false; reason: "plan" }
  | { ok: false; reason: "code"; code: CodeRefusal };

/** The price of a plan for a learner, with a code if one was typed. */
export async function quote(client: Client, userId: number, planId: number, rawCode: string | null, now: Date): Promise<Quote> {
  const plan = await client.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active) return { ok: false, reason: "plan" };
  const typed = rawCode?.trim() ? rawCode : null;
  if (!typed) return { ok: true, plan, price: plan.price_toman, off: 0, final: plan.price_toman, code: null };
  const check = await checkCode(client, typed, { userId, planId, price: plan.price_toman, now });
  if (!check.ok) return { ok: false, reason: "code", code: check.reason };
  return { ok: true, plan, price: plan.price_toman, off: check.off, final: check.final, code: check.code.code };
}

export type StartResult = { kind: "redirect"; url: string; orderId: number } | { kind: "free"; orderId: number } | { kind: "refused"; quote: Exclude<Quote, { ok: true }> } | { kind: "gateway"; orderId: number };

/**
 * «پرداخت»: a pending order priced on the server, then the gateway's page. A price of zero (a full
 * discount) skips the gateway and makes the subscription at once (PRD §12.3). `returnUrl` is our
 * address the gateway sends the learner back to; the order id is added to it.
 */
export async function startOrder(buyer: Buyer, planId: number, rawCode: string | null, returnUrl: string, now = new Date(), gateway: PaymentGateway = getGateway()): Promise<StartResult> {
  const priced = await quote(db, buyer.id, planId, rawCode, now);
  if (!priced.ok) return { kind: "refused", quote: priced };
  const codeRow = priced.code ? await db.discountCode.findUnique({ where: { code: priced.code }, select: { id: true } }) : null;
  const base = {
    user_id: buyer.id,
    plan_id: priced.plan.id,
    language: priced.plan.language,
    amount_toman: priced.price,
    discount_code_id: codeRow?.id ?? null,
    final_amount: priced.final,
    created_at: now,
  };
  if (priced.final === 0) {
    const order = await db.$transaction(async (tx) => {
      const row = await tx.order.create({ data: { ...base, gateway: "free", status: "pending" } });
      await settle(tx, row, null, now);
      return row;
    });
    return { kind: "free", orderId: order.id };
  }
  const order = await db.order.create({ data: { ...base, gateway: gateway.name, status: "pending" } });
  const callback = `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}order=${order.id}`;
  const started = await gateway.request({ orderId: order.id, amountToman: priced.final, callbackUrl: callback, description: `${priced.plan.name_fa} (${order.id})`, mobile: buyer.phone });
  if (!started.ok) {
    await db.order.update({ where: { id: order.id }, data: { status: "failed" } });
    return { kind: "gateway", orderId: order.id };
  }
  await db.order.update({ where: { id: order.id }, data: { authority: started.authority } });
  return { kind: "redirect", url: started.payUrl, orderId: order.id };
}

/**
 * Marks an order paid and makes its subscription and its code's use, once: a second call (a refreshed
 * return page, the follow-up job at the same moment) finds it paid and changes nothing.
 */
async function settle(tx: Prisma.TransactionClient, order: Order, ref: string | null, now: Date): Promise<boolean> {
  const claimed = await tx.order.updateMany({ where: { id: order.id, status: { not: "paid" } }, data: { status: "paid", paid_at: now, gateway_ref: ref } });
  if (claimed.count === 0) return false;
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: order.plan_id } });
  await extendAccess(tx, { userId: order.user_id, language: order.language, days: plan.duration_days, now, source: "payment", planId: plan.id, orderId: order.id });
  if (order.discount_code_id) await tx.discountUse.create({ data: { code_id: order.discount_code_id, user_id: order.user_id, order_id: order.id } });
  await tx.event.create({ data: { user_id: order.user_id, language: order.language, name: "purchase", props: { order: order.id, plan: plan.id, amount: order.final_amount }, ts: now } });
  return true;
}

/** Verifies with the gateway and settles; false when the gateway says not paid. Locks the order row first. */
async function verifyAndSettle(order: Order, gateway: PaymentGateway, now: Date): Promise<"paid" | "unpaid"> {
  if (!order.authority) return "unpaid";
  const verdict = await gateway.verify({ authority: order.authority, amountToman: order.final_amount });
  if (verdict.status !== "paid") return "unpaid";
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${order.id} FOR UPDATE`;
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    await settle(tx, fresh, verdict.ref, now);
  });
  return "paid";
}

export type ReturnResult = { kind: "paid" | "failed"; order: Order } | { kind: "unknown" };

/**
 * The learner is back from the gateway (PRD §12.4 steps 3–5). The address is not trusted: the order is
 * looked up by its own id and owner, and only the gateway's verify can make it paid.
 */
export async function returnFromGateway(userId: number, orderId: number, now = new Date(), gateway: PaymentGateway = getGateway()): Promise<ReturnResult> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.user_id !== userId) return { kind: "unknown" };
  if (order.status === "paid") return { kind: "paid", order };
  if (order.gateway !== gateway.name) return { kind: "failed", order };
  const result = await verifyAndSettle(order, gateway, now);
  const fresh = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (result === "paid" || fresh.status === "paid") return { kind: "paid", order: fresh };
  // Cancelled at the bank, or not verified: failed, with «دوباره تلاش کن». The follow-up may still find it paid.
  const failed = await db.order.updateMany({ where: { id: orderId, status: "pending" }, data: { status: "failed", last_verify_at: now } });
  return { kind: "failed", order: failed.count > 0 ? { ...fresh, status: "failed" } : fresh };
}

export type FollowUp = "paid" | "unpaid" | "waiting" | "gone";

/**
 * Asks the gateway about one order and settles it if it was paid: the follow-up job (PRD §12.4 step 6)
 * and «پیگیری پرداخت» (step 7). An order older than `order.expire_minutes` that the gateway says was
 * not paid becomes `expired`; one the gateway cannot answer for is left for the next try.
 */
export async function followUpOrder(order: Order, now: Date, gateway: PaymentGateway = getGateway()): Promise<FollowUp> {
  if (order.status === "paid") return "paid";
  if (!order.authority || order.gateway !== gateway.name) return "gone";
  const settings = await engineSettings();
  const answer = await gateway.inquire({ authority: order.authority, amountToman: order.final_amount });
  await db.order.update({ where: { id: order.id }, data: { last_verify_at: now } });
  if (answer === "paid") return verifyAndSettle(order, gateway, now).then((result) => (result === "paid" ? "paid" : "waiting"));
  if (answer === "unknown") return "waiting";
  const old = now.getTime() - order.created_at.getTime() >= num(settings, "order.expire_minutes") * 60_000;
  if (old && order.status === "pending") await db.order.updateMany({ where: { id: order.id, status: "pending" }, data: { status: "expired" } });
  return "unpaid";
}

/** «پیگیری پرداخت» for the learner's own order, while it is under `order.followup_hours` old. */
export async function followUpMine(userId: number, orderId: number, now = new Date(), gateway: PaymentGateway = getGateway()): Promise<FollowUp> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.user_id !== userId) return "gone";
  if (order.status === "paid") return "paid";
  if (!canFollowUp(order, num(await engineSettings(), "order.followup_hours"), now)) return "gone";
  return followUpOrder(order, now, gateway);
}

/** Whether «پیگیری پرداخت» shows: a pending, failed or expired order under `hours` old that reached the gateway. */
export function canFollowUp(order: Pick<Order, "status" | "created_at" | "authority">, hours: number, now: Date): boolean {
  return order.status !== "paid" && !!order.authority && now.getTime() - order.created_at.getTime() < hours * 3_600_000;
}

/**
 * The follow-up job (PRD §12.4 step 6), every few minutes from the host's scheduler: every pending
 * order past `order.expire_minutes` is asked about once; paid ones are settled, unpaid ones expire.
 */
export async function sweepOrders(now = new Date(), gateway: PaymentGateway = getGateway()) {
  const settings = await engineSettings();
  const due = new Date(now.getTime() - num(settings, "order.expire_minutes") * 60_000);
  const orders = await db.order.findMany({ where: { status: "pending", created_at: { lte: due } }, orderBy: { created_at: "asc" }, take: 200 });
  const counts = { paid: 0, expired: 0, waiting: 0 };
  for (const order of orders) {
    const result = order.authority && order.gateway === gateway.name ? await followUpOrder(order, now, gateway) : "unpaid";
    if (result === "paid") counts.paid++;
    else if (result === "waiting") {
      // A gateway that still cannot say after the follow-up window: the order expires; «پیگیری پرداخت» is over too.
      if (now.getTime() - order.created_at.getTime() >= num(settings, "order.followup_hours") * 3_600_000) {
        await db.order.updateMany({ where: { id: order.id, status: "pending" }, data: { status: "expired" } });
        counts.expired++;
      } else counts.waiting++;
    } else {
      await db.order.updateMany({ where: { id: order.id, status: "pending" }, data: { status: "expired" } });
      counts.expired++;
    }
  }
  return counts;
}
