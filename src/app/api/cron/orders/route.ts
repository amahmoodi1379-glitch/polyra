import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { sweepOrders } from "@/server/billing/orders";
import { logError } from "@/server/errors";

/**
 * The follow-up job for payments (PRD §12.4 step 6): the host's scheduler calls this every few minutes
 * with `Authorization: Bearer <CRON_SECRET>`. Each pending order past `order.expire_minutes` is asked
 * about once: paid ones get their subscription, unpaid ones expire. Without `CRON_SECRET` it is off.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, reason: "off" }, { status: 404 });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || request.nextUrl.searchParams.get("key") || "";
  const digest = (text: string) => createHash("sha256").update(text).digest();
  if (!timingSafeEqual(digest(given), digest(secret))) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await sweepOrders()) });
  } catch (error) {
    const code = await logError("cron/orders", error);
    return NextResponse.json({ ok: false, code }, { status: 500 });
  }
}

export const GET = POST;
export const dynamic = "force-dynamic";
