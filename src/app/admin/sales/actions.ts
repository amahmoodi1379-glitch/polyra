"use server";

import { revalidatePath } from "next/cache";
import { addDays, tehranDate } from "@/engine/time";
import { toAsciiDigits } from "@/lib/phone";
import { requireAdmin } from "@/server/auth/session";
import { grantAccess, saveCode, savePlan, shortenSubscription, type CodeInput, type FieldErrors, type GrantInput, type PlanInput, type ShortenInput } from "@/server/billing/admin";
import { followUpOrder, type FollowUp } from "@/server/billing/orders";
import { db } from "@/server/db";
import { logError } from "@/server/errors";

/** The panel's sales actions (PRD §12.2–§12.4, §13.2); each one checks the admin and logs. */

export type FormReply = { ok: true } | { ok: false; errors: FieldErrors } | { ok: false; failed: string };

async function run(where: string, act: (adminId: number) => Promise<{ ok: true } | { ok: false; errors: FieldErrors }>, paths: string[]): Promise<FormReply> {
  const admin = await requireAdmin();
  try {
    const result = await act(admin.id);
    if (result.ok) for (const path of paths) revalidatePath(path);
    return result.ok ? { ok: true } : { ok: false, errors: result.errors };
  } catch (error) {
    return { ok: false, failed: await logError(where, error, { userId: admin.id }) };
  }
}

export async function savePlanAction(id: number | null, input: PlanInput): Promise<FormReply> {
  return run("sales.plan", (adminId) => savePlan(adminId, id, input), ["/admin/sales"]);
}

/** `valid_days`: the code works until the end of that many days from today in Tehran (empty: no end). */
export async function saveCodeAction(id: number | null, input: CodeInput & { valid_days?: string; keep_end?: boolean }): Promise<FormReply> {
  const { valid_days, keep_end, ...rest } = input;
  const days = valid_days === undefined ? "" : toAsciiDigits(valid_days).trim();
  if (days !== "" && !/^\d+$/.test(days)) return { ok: false, errors: { valid_to: "number" } };
  const validTo = keep_end ? rest.valid_to : days === "" ? null : new Date(`${addDays(tehranDate(new Date()), Number(days))}T23:59:59+03:30`).toISOString();
  return run("sales.code", (adminId) => saveCode(adminId, id, { ...rest, valid_to: validTo }), ["/admin/sales"]);
}

export async function grantAction(userId: number, input: GrantInput): Promise<FormReply> {
  return run("sales.grant", (adminId) => grantAccess(adminId, userId, input), [`/admin/users/${userId}`]);
}

export async function shortenAction(userId: number, input: ShortenInput): Promise<FormReply> {
  return run("sales.shorten", (adminId) => shortenSubscription(adminId, userId, input), [`/admin/users/${userId}`]);
}

/** «استعلام دوباره» on «سفارش‌ها»: asks the gateway about one order now, whatever its age. */
export async function recheckOrder(orderId: number): Promise<FollowUp | "failed"> {
  const admin = await requireAdmin();
  try {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) return "gone";
    const result = await followUpOrder(order, new Date());
    revalidatePath("/admin/orders");
    return result;
  } catch (error) {
    await logError("sales.recheck", error, { userId: admin.id });
    return "failed";
  }
}
