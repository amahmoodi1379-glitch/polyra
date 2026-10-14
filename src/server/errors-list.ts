import { Prisma } from "@/generated/prisma/client";
import { toAsciiDigits } from "@/lib/phone";
import { db } from "@/server/db";
import { kindOfWhere, type ErrorGroup, type ErrorKind } from "@/server/error-report";

export const ERRORS_PAGE_SIZE = 20;

/** A repeat is stored as "code-XXXX"; the part before the dash is the error's code. */
const CODE = Prisma.sql`split_part(id, '-', 1)`;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

function filters(kind: ErrorKind | null, q: string) {
  const conditions: Prisma.Sql[] = [];
  if (kind === "browser") conditions.push(Prisma.sql`"where" LIKE 'browser %'`);
  if (kind === "server") conditions.push(Prisma.sql`"where" NOT LIKE 'browser %'`);
  if (q) {
    const like = `%${escapeLike(q)}%`;
    conditions.push(Prisma.sql`(${CODE} ILIKE ${like} OR message ILIKE ${like} OR "where" ILIKE ${like})`);
  }
  return conditions;
}

const whereOf = (conditions: Prisma.Sql[]) => (conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty);

/**
 * «خطاها» (PRD §15.9): every error once, with how often and since when, newest first. `q` finds a
 * code, a word of the message or a page.
 */
export async function listErrors({ kind = null, q = "", page = 1 }: { kind?: ErrorKind | null; q?: string; page?: number }) {
  const search = toAsciiDigits(q).trim().slice(0, 200);
  const where = whereOf(filters(kind, search));

  const [{ total }] = await db.$queryRaw<{ total: number }[]>`SELECT count(DISTINCT ${CODE})::int AS total FROM error_log ${where}`;
  const pages = Math.max(1, Math.ceil(total / ERRORS_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);

  const groups = await db.$queryRaw<{ code: string; count: number; users: number; first: Date; last: Date }[]>`
    SELECT ${CODE} AS code, count(*)::int AS count, count(DISTINCT user_id)::int AS users, min(ts) AS first, max(ts) AS last
    FROM error_log ${where}
    GROUP BY 1
    ORDER BY last DESC, code
    LIMIT ${ERRORS_PAGE_SIZE} OFFSET ${(current - 1) * ERRORS_PAGE_SIZE}`;

  const latest = groups.length
    ? await db.$queryRaw<{ code: string; where: string; message: string; stack: string | null; user_id: number | null; request_id: string | null }[]>`
        SELECT DISTINCT ON (${CODE}) ${CODE} AS code, "where", message, stack, user_id, request_id
        FROM error_log
        WHERE ${CODE} IN (${Prisma.join(groups.map((group) => group.code))})
        ORDER BY ${CODE}, ts DESC`
    : [];
  const rowOf = new Map(latest.map((row) => [row.code, row]));
  const userIds = [...new Set(latest.flatMap((row) => (row.user_id === null ? [] : [row.user_id])))];
  const phones = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, phone: true } })).map((user) => [user.id, user.phone]));

  const items: ErrorGroup[] = groups.map((group) => {
    const row = rowOf.get(group.code)!;
    return {
      ...group,
      kind: kindOfWhere(row.where),
      where: row.where,
      message: row.message,
      stack: row.stack,
      requestId: row.request_id,
      phone: row.user_id === null ? null : (phones.get(row.user_id) ?? null),
    };
  });
  return { items, total, page: current, pages, q: search };
}

/** How many different errors each tab holds, for the counts beside «سرور» and «مرورگر». */
export async function errorCounts(): Promise<Record<ErrorKind | "all", number>> {
  const rows = await db.$queryRaw<{ browser: boolean; total: number }[]>`
    SELECT ("where" LIKE 'browser %') AS browser, count(DISTINCT ${CODE})::int AS total FROM error_log GROUP BY 1`;
  const server = rows.find((row) => !row.browser)?.total ?? 0;
  const browser = rows.find((row) => row.browser)?.total ?? 0;
  return { all: server + browser, server, browser };
}
