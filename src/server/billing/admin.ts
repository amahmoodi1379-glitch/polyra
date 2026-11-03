import type { DiscountType, Prisma } from "@/generated/prisma/client";
import { toAsciiDigits } from "@/lib/phone";
import { ACCOUNT_ENTITY } from "@/server/accounts";
import { changes, logChange, plain } from "@/server/content/library/log";
import { languageCodes } from "@/server/content/languages";
import { db } from "@/server/db";
import { normalizeCode } from "./discounts";
import { extendAccess, shortenAccess } from "./subscriptions";

/**
 * The panel's sales pages (PRD §13.2): «پلن‌ها و کدها» (PRD §12.2, §12.3), «سفارش‌ها», and on an
 * account a manual grant, a shorter subscription or a cancelled one. Every change is in `admin_log`:
 * plans and codes as `sales` rows, grants on the account's own row.
 */

export const SALES_ENTITY = "sales";
export const planKey = (id: number) => `plan:${id}`;
export const codeKey = (id: number) => `code:${id}`;

/** Limits that keep a typo from selling a plan for ten years or a 0-toman month. */
export const PLAN_LIMITS = { nameMax: 60, badgeMax: 30, daysMin: 1, daysMax: 3650, priceMin: 1000, priceMax: 100_000_000 };
export const CODE_LIMITS = { codeMin: 3, codeMax: 32, percentMax: 100, amountMax: 100_000_000, usesMax: 1_000_000 };
export const GRANT_LIMITS = { daysMax: 3650, noteMax: 300 };

export type FieldErrors = Record<string, string>;
export type SaveResult = { ok: true; id: number } | { ok: false; errors: FieldErrors };

const int = (raw: unknown): number | null => {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const digits = toAsciiDigits(raw).replace(/[,،٬\s]/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : null;
};
const text = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");

// ───────────────────────────── plans ─────────────────────────────

export type PlanInput = { language: unknown; name_fa: unknown; duration_days: unknown; price_toman: unknown; badge_fa?: unknown; sort_order?: unknown; active?: unknown };

/** A plan's fields checked one by one; each problem is a key of `admin.sales.errors` with the field it belongs to. */
export function checkPlan(input: PlanInput): { ok: true; data: Prisma.PlanCreateInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const language = text(input.language);
  if (!(languageCodes as readonly string[]).includes(language)) errors.language = "language";
  const name = text(input.name_fa);
  if (!name) errors.name_fa = "required";
  else if (name.length > PLAN_LIMITS.nameMax) errors.name_fa = "long";
  const days = int(input.duration_days);
  if (days === null || days < PLAN_LIMITS.daysMin || days > PLAN_LIMITS.daysMax) errors.duration_days = "days";
  const price = int(input.price_toman);
  if (price === null || price < PLAN_LIMITS.priceMin || price > PLAN_LIMITS.priceMax) errors.price_toman = "price";
  const badge = text(input.badge_fa);
  if (badge.length > PLAN_LIMITS.badgeMax) errors.badge_fa = "long";
  const sort = input.sort_order === undefined || input.sort_order === "" ? 0 : int(input.sort_order);
  if (sort === null) errors.sort_order = "number";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { language, name_fa: name, duration_days: days!, price_toman: price!, badge_fa: badge || null, sort_order: sort!, active: input.active === undefined ? true : !!input.active, module_codes: [] },
  };
}

export async function savePlan(adminId: number, id: number | null, input: PlanInput): Promise<SaveResult> {
  const checked = checkPlan(input);
  if (!checked.ok) return checked;
  return db.$transaction(async (tx): Promise<SaveResult> => {
    if (id === null) {
      const plan = await tx.plan.create({ data: checked.data });
      await logChange(tx, adminId, { action: "add", entity: SALES_ENTITY, entityId: planKey(plan.id), before: null, after: plain(checked.data) as Record<string, unknown> });
      return { ok: true, id: plan.id };
    }
    const plan = await tx.plan.findUnique({ where: { id } });
    if (!plan) return { ok: false, errors: { form: "gone" } };
    // A plan's language stays: orders and subscriptions already point at it.
    const next = { ...checked.data, language: plan.language, module_codes: plan.module_codes };
    const diff = changes(plan, next);
    if (diff) {
      await tx.plan.update({ where: { id }, data: diff.after });
      await logChange(tx, adminId, { action: "edit", entity: SALES_ENTITY, entityId: planKey(id), before: diff.before, after: diff.after });
    }
    return { ok: true, id };
  });
}

/** Plans of a language (or every language), with how many were sold. */
export async function planList(language: string | null) {
  const plans = await db.plan.findMany({ where: language ? { language } : {}, orderBy: [{ language: "asc" }, { active: "desc" }, { sort_order: "asc" }, { id: "asc" }] });
  const sold = await db.order.groupBy({ by: ["plan_id"], where: { status: "paid", plan_id: { in: plans.map((plan) => plan.id) } }, _count: { _all: true } });
  const count = new Map(sold.map((row) => [row.plan_id, row._count._all]));
  return plans.map((plan) => ({ ...plan, sold: count.get(plan.id) ?? 0 }));
}

// ───────────────────────────── discount codes ─────────────────────────────

export type CodeInput = {
  code: unknown;
  type: unknown;
  value: unknown;
  valid_from?: unknown;
  valid_to?: unknown;
  max_uses_total?: unknown;
  max_uses_per_user?: unknown;
  plan_ids?: unknown;
  active?: unknown;
};

const dateOf = (raw: unknown): Date | null | "bad" => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? "bad" : raw;
  if (typeof raw !== "string") return "bad";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "bad" : date;
};

export function checkCodeInput(input: CodeInput, plans: { id: number }[]): { ok: true; data: Prisma.DiscountCodeCreateInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const code = normalizeCode(text(input.code));
  if (!code) errors.code = "required";
  else if (code.length < CODE_LIMITS.codeMin || code.length > CODE_LIMITS.codeMax || !/^[A-Z0-9_-]+$/.test(code)) errors.code = "code";
  const type = input.type === "percent" || input.type === "amount" ? (input.type as DiscountType) : null;
  if (!type) errors.type = "required";
  const value = int(input.value);
  if (value === null || value < 1 || (type === "percent" && value > CODE_LIMITS.percentMax) || (type === "amount" && value > CODE_LIMITS.amountMax)) errors.value = type === "percent" ? "percent" : "amount";
  const from = dateOf(input.valid_from);
  const to = dateOf(input.valid_to);
  if (from === "bad") errors.valid_from = "date";
  if (to === "bad") errors.valid_to = "date";
  if (from instanceof Date && to instanceof Date && to <= from) errors.valid_to = "range";
  const total = input.max_uses_total === undefined || input.max_uses_total === "" || input.max_uses_total === null ? null : int(input.max_uses_total);
  if (total === null && input.max_uses_total !== undefined && input.max_uses_total !== "" && input.max_uses_total !== null) errors.max_uses_total = "number";
  else if (total !== null && (total < 1 || total > CODE_LIMITS.usesMax)) errors.max_uses_total = "number";
  const perUser = input.max_uses_per_user === undefined || input.max_uses_per_user === "" ? 1 : int(input.max_uses_per_user);
  if (perUser === null || perUser < 1 || perUser > CODE_LIMITS.usesMax) errors.max_uses_per_user = "number";
  const known = new Set(plans.map((plan) => plan.id));
  const ids = Array.isArray(input.plan_ids) ? input.plan_ids.map((id) => int(id)) : [];
  if (ids.some((id) => id === null || !known.has(id))) errors.plan_ids = "plans";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      code,
      type: type!,
      value: value!,
      valid_from: from as Date | null,
      valid_to: to as Date | null,
      max_uses_total: total,
      max_uses_per_user: perUser!,
      plan_ids: [...new Set(ids as number[])].sort((a, b) => a - b),
      active: input.active === undefined ? true : !!input.active,
    },
  };
}

export async function saveCode(adminId: number, id: number | null, input: CodeInput): Promise<SaveResult> {
  const plans = await db.plan.findMany({ select: { id: true } });
  const checked = checkCodeInput(input, plans);
  if (!checked.ok) return checked;
  return db.$transaction(async (tx): Promise<SaveResult> => {
    const same = await tx.discountCode.findUnique({ where: { code: checked.data.code }, select: { id: true } });
    if (same && same.id !== id) return { ok: false, errors: { code: "taken" } };
    if (id === null) {
      const row = await tx.discountCode.create({ data: checked.data });
      await logChange(tx, adminId, { action: "add", entity: SALES_ENTITY, entityId: codeKey(row.id), before: null, after: plain(checked.data) as Record<string, unknown> });
      return { ok: true, id: row.id };
    }
    const row = await tx.discountCode.findUnique({ where: { id } });
    if (!row) return { ok: false, errors: { form: "gone" } };
    const diff = changes(row, checked.data as Record<string, unknown>);
    if (diff) {
      await tx.discountCode.update({ where: { id }, data: diff.after });
      await logChange(tx, adminId, { action: "edit", entity: SALES_ENTITY, entityId: codeKey(id), before: diff.before, after: diff.after });
    }
    return { ok: true, id };
  });
}

export async function codeList() {
  const codes = await db.discountCode.findMany({ orderBy: [{ active: "desc" }, { id: "desc" }] });
  const used = await db.discountUse.groupBy({ by: ["code_id"], _count: { _all: true } });
  const count = new Map(used.map((row) => [row.code_id, row._count._all]));
  return codes.map((code) => ({ ...code, used: count.get(code.id) ?? 0 }));
}

// ───────────────────────────── orders ─────────────────────────────

export const ORDERS_PAGE = 30;
export type OrderFilter = { status?: "pending" | "paid" | "failed" | "expired"; language?: string | null; page?: number };

/** «سفارش‌ها»: newest first, with the phone, plan, amounts and tracking numbers. */
export async function orderList(filter: OrderFilter) {
  const where: Prisma.OrderWhereInput = { ...(filter.status ? { status: filter.status } : {}), ...(filter.language ? { language: filter.language } : {}) };
  const page = Math.max(1, filter.page ?? 1);
  const [rows, total] = await Promise.all([
    db.order.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * ORDERS_PAGE, take: ORDERS_PAGE, include: { user: { select: { phone: true } } } }),
    db.order.count({ where }),
  ]);
  const plans = await db.plan.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.plan_id))] } }, select: { id: true, name_fa: true } });
  const codes = await db.discountCode.findMany({ where: { id: { in: rows.map((row) => row.discount_code_id).filter((id): id is number => id !== null) } }, select: { id: true, code: true } });
  const planName = new Map(plans.map((plan) => [plan.id, plan.name_fa]));
  const codeName = new Map(codes.map((code) => [code.id, code.code]));
  return {
    rows: rows.map((row) => ({ ...row, phone: row.user.phone, plan: planName.get(row.plan_id) ?? null, code: row.discount_code_id ? (codeName.get(row.discount_code_id) ?? null) : null })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / ORDERS_PAGE)),
  };
}

// ───────────────────────────── grants ─────────────────────────────

export type GrantInput = { language: unknown; planId?: unknown; days?: unknown; note: unknown };
export type GrantResult = { ok: true; endsAt: Date } | { ok: false; errors: FieldErrors };

/**
 * «اعطای دستی» (PRD §12.3): a plan's days or any number of days, with a required note; the same
 * validity rule as a purchase. Logged on the account.
 */
export async function grantAccess(adminId: number, userId: number, input: GrantInput, now = new Date()): Promise<GrantResult> {
  const errors: FieldErrors = {};
  const language = text(input.language);
  if (!(languageCodes as readonly string[]).includes(language)) errors.language = "language";
  const note = text(input.note);
  if (!note) errors.note = "required";
  else if (note.length > GRANT_LIMITS.noteMax) errors.note = "long";
  const planId = input.planId === undefined || input.planId === "" || input.planId === null ? null : int(input.planId);
  const plan = planId !== null ? await db.plan.findUnique({ where: { id: planId } }) : null;
  if (planId !== null && (!plan || plan.language !== language)) errors.planId = "plans";
  const days = plan ? plan.duration_days : int(input.days);
  if (!plan && (days === null || days < 1 || days > GRANT_LIMITS.daysMax)) errors.days = "days";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return db.$transaction(async (tx): Promise<GrantResult> => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { deleted_at: true } });
    if (!user || user.deleted_at) return { ok: false, errors: { form: "gone" } };
    const row = await extendAccess(tx, { userId, language, days: days!, now, source: "manual", planId: plan?.id ?? null, grantedBy: adminId, note });
    await logChange(tx, adminId, {
      action: "grant",
      entity: ACCOUNT_ENTITY,
      entityId: userId,
      before: null,
      after: plain({ language, days, plan: plan?.name_fa ?? null, note, ends_at: row.ends_at }) as Record<string, unknown>,
    });
    return { ok: true, endsAt: row.ends_at };
  });
}

export type ShortenInput = { language: unknown; days?: unknown; cancel?: unknown; note: unknown };

/** «کم کردن» some days or «لغو» what is left of a language's subscription (PRD §12.3, a manual refund). */
export async function shortenSubscription(adminId: number, userId: number, input: ShortenInput, now = new Date()): Promise<{ ok: true; changed: number } | { ok: false; errors: FieldErrors }> {
  const errors: FieldErrors = {};
  const language = text(input.language);
  if (!(languageCodes as readonly string[]).includes(language)) errors.language = "language";
  const note = text(input.note);
  if (!note) errors.note = "required";
  else if (note.length > GRANT_LIMITS.noteMax) errors.note = "long";
  const cancel = !!input.cancel;
  const days = cancel ? null : int(input.days);
  if (!cancel && (days === null || days < 1 || days > GRANT_LIMITS.daysMax)) errors.days = "days";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return db.$transaction(async (tx): Promise<{ ok: true; changed: number } | { ok: false; errors: FieldErrors }> => {
    const changed = await shortenAccess(tx, userId, language, days, now);
    if (changed.length === 0) return { ok: false, errors: { form: "none" } };
    const latest = await tx.subscription.findFirst({ where: { user_id: userId, language }, orderBy: { ends_at: "desc" }, select: { ends_at: true } });
    const before = changed.reduce((max, row) => (row.before.ends_at > max ? row.before.ends_at : max), changed[0].before.ends_at);
    await logChange(tx, adminId, {
      action: "shorten",
      entity: ACCOUNT_ENTITY,
      entityId: userId,
      before: plain({ language, ends_at: before }) as Record<string, unknown>,
      after: plain({ language, days, cancel, note, ends_at: latest?.ends_at ?? now }) as Record<string, unknown>,
    });
    return { ok: true, changed: changed.length };
  });
}

// ───────────────────────────── one account ─────────────────────────────

/** An account's subscriptions (newest end first) and orders, for its page in «کاربران». */
export async function accountSales(userId: number) {
  const [subscriptions, orders] = await Promise.all([
    db.subscription.findMany({ where: { user_id: userId }, orderBy: { ends_at: "desc" } }),
    db.order.findMany({ where: { user_id: userId }, orderBy: { created_at: "desc" }, take: 20 }),
  ]);
  const planIds = [...new Set([...subscriptions.map((row) => row.plan_id), ...orders.map((row) => row.plan_id)].filter((id): id is number => id !== null))];
  const adminIds = [...new Set(subscriptions.map((row) => row.granted_by).filter((id): id is number => id !== null))];
  const [plans, admins] = await Promise.all([
    db.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name_fa: true } }),
    db.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, phone: true } }),
  ]);
  const planName = new Map(plans.map((plan) => [plan.id, plan.name_fa]));
  const adminPhone = new Map(admins.map((user) => [user.id, user.phone]));
  return {
    subscriptions: subscriptions.map((row) => ({ ...row, plan: row.plan_id ? (planName.get(row.plan_id) ?? null) : null, grantedByPhone: row.granted_by ? (adminPhone.get(row.granted_by) ?? null) : null })),
    orders: orders.map((row) => ({ ...row, plan: planName.get(row.plan_id) ?? null })),
  };
}

/** Plans to choose from on a grant: every plan of every language, active ones first. */
export async function grantPlans() {
  return db.plan.findMany({ orderBy: [{ language: "asc" }, { active: "desc" }, { sort_order: "asc" }], select: { id: true, language: true, name_fa: true, duration_days: true, active: true } });
}
