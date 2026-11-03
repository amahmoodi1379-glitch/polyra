import type { DiscountCode, Prisma } from "@/generated/prisma/client";
import { toAsciiDigits } from "@/lib/phone";
import { db } from "@/server/db";

/**
 * Discount codes (PRD §12.3): one code, case-insensitive, percent or a fixed amount in tomans, a date
 * range, a cap on all uses and on each user's, and the plans it is for. A use counts only once its
 * order is paid (`discount_use`), so a code typed and left unpaid takes nothing.
 */

type Client = Prisma.TransactionClient | typeof db;

/** How codes are stored and looked up: upper case, Persian digits and spaces dropped. */
export function normalizeCode(raw: string): string {
  return toAsciiDigits(raw).replace(/\s+/g, "").toUpperCase();
}

export type CodeRefusal = "unknown" | "inactive" | "early" | "expired" | "plan" | "full" | "used";
export type CodeCheck = { ok: true; code: DiscountCode; off: number; final: number } | { ok: false; reason: CodeRefusal };

/** What the code takes off a price: a percent rounded down to a whole toman, or the fixed amount; never below zero. */
export function discountOff(code: Pick<DiscountCode, "type" | "value">, price: number): number {
  const off = code.type === "percent" ? Math.floor((price * Math.min(100, Math.max(0, code.value))) / 100) : Math.max(0, code.value);
  return Math.min(price, off);
}

/** Whether a code may be used on a plan by a user now, and the price with it. */
export async function checkCode(client: Client, raw: string, input: { userId: number; planId: number; price: number; now: Date }): Promise<CodeCheck> {
  const code = await client.discountCode.findUnique({ where: { code: normalizeCode(raw) } });
  if (!code) return { ok: false, reason: "unknown" };
  if (!code.active) return { ok: false, reason: "inactive" };
  if (code.valid_from && input.now < code.valid_from) return { ok: false, reason: "early" };
  if (code.valid_to && input.now > code.valid_to) return { ok: false, reason: "expired" };
  if (code.plan_ids.length > 0 && !code.plan_ids.includes(input.planId)) return { ok: false, reason: "plan" };
  if (code.max_uses_total !== null && (await client.discountUse.count({ where: { code_id: code.id } })) >= code.max_uses_total) return { ok: false, reason: "full" };
  if ((await client.discountUse.count({ where: { code_id: code.id, user_id: input.userId } })) >= code.max_uses_per_user) return { ok: false, reason: "used" };
  const off = discountOff(code, input.price);
  return { ok: true, code, off, final: input.price - off };
}
