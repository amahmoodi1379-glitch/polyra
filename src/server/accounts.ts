import type { Prisma } from "@/generated/prisma/client";
import { normalizeMobile, toAsciiDigits } from "@/lib/phone";
import { changes, logChange } from "@/server/content/library/log";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";

/**
 * «کاربران» (PRD §13.2): find an account by phone, see its languages and devices, and turn
 * `is_admin` and `is_tester` on or off. A phone that has no account yet can be added straight away as
 * a teacher or a tester, so their first sign-in lands where it should. Subscriptions, manual grants
 * and changing a phone come with payments (PRD §16.4, phase 4). Every change goes to `admin_log`.
 */

export const ACCOUNT_ENTITY = "user";
export const SEARCH_LIMIT = 30;
const RECENT = 10;
const MIN_DIGITS = 3;

export const adminLanguages = ["fr", "de", "all"] as const;
export type AdminLanguage = (typeof adminLanguages)[number];
export const isAdminLanguage = (value: unknown): value is AdminLanguage => adminLanguages.includes(value as AdminLanguage);

const rowSelect = {
  id: true,
  phone: true,
  created_at: true,
  is_admin: true,
  admin_language: true,
  is_tester: true,
  auth_devices: { select: { last_seen_at: true }, orderBy: { last_seen_at: "desc" } },
  enrollments: { select: { language: true }, orderBy: { created_at: "asc" } },
} satisfies Prisma.UserSelect;

type RowData = Prisma.UserGetPayload<{ select: typeof rowSelect }>;
export type AccountRow = {
  id: number;
  phone: string;
  createdAt: Date;
  isAdmin: boolean;
  adminLanguage: AdminLanguage | null;
  isTester: boolean;
  devices: number;
  lastSeen: Date | null;
  languages: string[];
};

const toRow = (user: RowData): AccountRow => ({
  id: user.id,
  phone: user.phone!,
  createdAt: user.created_at,
  isAdmin: user.is_admin,
  adminLanguage: isAdminLanguage(user.admin_language) ? user.admin_language : null,
  isTester: user.is_tester,
  devices: user.auth_devices.length,
  lastSeen: user.auth_devices[0]?.last_seen_at ?? null,
  languages: user.enrollments.map((item) => item.language),
});

const live = { deleted_at: null, phone: { not: null } } satisfies Prisma.UserWhereInput;

/**
 * What people type to find a number, as the digits to look for inside the stored +98 number:
 * Persian digits, spaces and dashes are fine; a leading 0, 98, +98 or 0098 is dropped.
 */
export function phoneDigits(query: string): string | null {
  let digits = toAsciiDigits(query).replace(/\D/g, "");
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("98") && digits.length > 10) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= MIN_DIGITS ? digits : null;
}

export type AccountSearch = { state: "short" } | { state: "found"; rows: AccountRow[]; more: boolean; newPhone: string | null };

/** Accounts whose number has these digits; `newPhone` is a whole number that has no account yet. */
export async function searchAccounts(query: string): Promise<AccountSearch> {
  const digits = phoneDigits(query);
  if (!digits) return { state: "short" };
  const users = await db.user.findMany({
    where: { ...live, phone: { contains: digits } },
    orderBy: { created_at: "desc" },
    take: SEARCH_LIMIT + 1,
    select: rowSelect,
  });
  const whole = normalizeMobile(query);
  const newPhone = whole && !(await db.user.findUnique({ where: { phone: whole }, select: { id: true } })) ? whole : null;
  return { state: "found", rows: users.slice(0, SEARCH_LIMIT).map(toRow), more: users.length > SEARCH_LIMIT, newPhone };
}

/** The page without a search: teachers, testers and the newest sign-ups. */
export async function accountLists() {
  const [admins, testers, recent, total] = await Promise.all([
    db.user.findMany({ where: { ...live, is_admin: true }, orderBy: { created_at: "asc" }, select: rowSelect }),
    db.user.findMany({ where: { ...live, is_tester: true, is_admin: false }, orderBy: { created_at: "asc" }, select: rowSelect }),
    db.user.findMany({ where: { ...live, is_admin: false, is_tester: false }, orderBy: { created_at: "desc" }, take: RECENT, select: rowSelect }),
    db.user.count({ where: live }),
  ]);
  return { admins: admins.map(toRow), testers: testers.map(toRow), recent: recent.map(toRow), total };
}

export async function accountDetail(id: number) {
  const user = await db.user.findUnique({
    where: { id },
    select: {
      ...rowSelect,
      deleted_at: true,
      session_length_min: true,
      auth_devices: { select: { id: true, user_agent: true, last_seen_at: true, created_at: true }, orderBy: { last_seen_at: "desc" } },
      enrollments: { select: { language: true, created_at: true, trial_started_at: true, trial_ends_at: true }, orderBy: { created_at: "asc" } },
      skill_levels: { select: { language: true, skill: true, level: true } },
      subscriptions: { select: { language: true, starts_at: true, ends_at: true, source: true }, orderBy: { ends_at: "desc" } },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    phone: user.phone,
    deleted: user.deleted_at !== null,
    createdAt: user.created_at,
    isAdmin: user.is_admin,
    adminLanguage: isAdminLanguage(user.admin_language) ? user.admin_language : null,
    isTester: user.is_tester,
    sessionLength: user.session_length_min,
    devices: user.auth_devices,
    languages: user.enrollments.map((enrollment) => ({
      ...enrollment,
      skills: user.skill_levels.filter((skill) => skill.language === enrollment.language),
      subscription: user.subscriptions.find((item) => item.language === enrollment.language) ?? null,
    })),
  };
}
export type AccountDetail = NonNullable<Awaited<ReturnType<typeof accountDetail>>>;

export type AccessChange = { is_admin?: boolean; admin_language?: AdminLanguage; is_tester?: boolean };
export type AccessResult = { ok: true; changed: boolean } | { ok: false; reason: "self" | "gone" | "invalid" };

/**
 * Turns admin and tester on or off. An admin cannot take away their own admin access, so the panel
 * always keeps at least the person using it. Taking admin away also clears the panel language.
 */
export async function setAccess(adminId: number, userId: number, change: AccessChange): Promise<AccessResult> {
  if (change.admin_language !== undefined && !isAdminLanguage(change.admin_language)) return { ok: false, reason: "invalid" };
  if (userId === adminId && change.is_admin === false) return { ok: false, reason: "self" };
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { is_admin: true, admin_language: true, is_tester: true, deleted_at: true } });
    if (!user || user.deleted_at) return { ok: false, reason: "gone" } as const;
    const isAdmin = change.is_admin ?? user.is_admin;
    const next = {
      is_admin: isAdmin,
      admin_language: isAdmin ? (change.admin_language ?? (isAdminLanguage(user.admin_language) ? user.admin_language : "all")) : null,
      is_tester: change.is_tester ?? user.is_tester,
    };
    const diff = changes(user, next);
    if (!diff) return { ok: true, changed: false } as const;
    await tx.user.update({ where: { id: userId }, data: diff.after });
    await logChange(tx, adminId, { action: "access", entity: ACCOUNT_ENTITY, entityId: userId, before: diff.before, after: diff.after });
    return { ok: true, changed: true } as const;
  });
}

export type CreateResult = { ok: true; id: number } | { ok: false; reason: "phone" | "invalid" } | { ok: false; reason: "exists"; id: number };

/** An account for a phone that has none yet, already a teacher or a tester. */
export async function createAccount(adminId: number, input: { phone: string; role: "admin" | "tester"; language?: AdminLanguage }): Promise<CreateResult> {
  const phone = normalizeMobile(input.phone);
  if (!phone) return { ok: false, reason: "phone" };
  if (input.role !== "admin" && input.role !== "tester") return { ok: false, reason: "invalid" };
  if (input.language !== undefined && !isAdminLanguage(input.language)) return { ok: false, reason: "invalid" };
  const sessionLength = await engineNumber("session.default_length");
  return db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { phone }, select: { id: true } });
    if (existing) return { ok: false, reason: "exists", id: existing.id } as const;
    const access =
      input.role === "admin" ? { is_admin: true, admin_language: input.language ?? "all", is_tester: false } : { is_admin: false, admin_language: null, is_tester: true };
    const user = await tx.user.create({ data: { phone, session_length_min: sessionLength, ...access }, select: { id: true } });
    await logChange(tx, adminId, { action: "account", entity: ACCOUNT_ENTITY, entityId: user.id, before: null, after: { phone, ...access } });
    return { ok: true, id: user.id } as const;
  });
}
