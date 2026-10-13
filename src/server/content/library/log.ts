import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "../kinds/types";

/**
 * Every admin change goes to `admin_log` with what it was before and after (PRD §13.1). `before`
 * and `after` hold only the columns that changed (plus child rows such as a sentence's word mapping
 * under their own key), so the change log can show them and "برگردان" can put `before` back.
 */
export type LogAction = "edit" | "status" | "delete" | "order" | "revert" | "publish" | "release" | "live" | "audio";

export type LogEntry = {
  action: LogAction;
  entity: string;
  entityId: number | string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/**
 * Values as JSON keeps them: dates as ISO text and keys in one order (the database reorders the keys
 * of a JSON column), so a stored value compares equal to a fresh one.
 */
export function plain(value: unknown): unknown {
  return sortKeys(JSON.parse(JSON.stringify(value ?? null)));
}

export const same = (a: unknown, b: unknown) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));

/** The fields of `after` that differ from `before`, with both sides; null when nothing changed. */
export function changes(before: Record<string, unknown>, after: Record<string, unknown>) {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (same(before[key], after[key])) continue;
    from[key] = plain(before[key]);
    to[key] = plain(after[key]);
  }
  return Object.keys(to).length > 0 ? { before: from, after: to } : null;
}

export async function logChange(tx: Tx, adminId: number | null, entry: LogEntry) {
  await tx.adminLog.create({
    data: {
      admin_id: adminId,
      action: entry.action,
      entity: entry.entity,
      entity_id: String(entry.entityId),
      before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
