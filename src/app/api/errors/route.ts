import { clientIp, getCurrentUser } from "@/server/auth/session";
import { logError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** At most this many reports from one address in WINDOW_MS; a page stuck in a loop cannot fill the table. */
const PER_WINDOW = 20;
const WINDOW_MS = 10 * 60_000;
const BODY_MAX = 24_000;
const seen = new Map<string, number[]>();

function allowed(ip: string, now: number) {
  const times = (seen.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  if (seen.size > 5000) seen.clear();
  if (times.length >= PER_WINDOW) return false;
  seen.set(ip, [...times, now]);
  return true;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

/**
 * Errors in the learner's or teacher's browser (PRD §15.9): the page sends the message, the stack and
 * where it happened, and gets back the short code its error screen shows.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > BODY_MAX) return Response.json({ ok: false }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const message = text(body.message, 2000).trim();
  const where = text(body.where, 300).trim() || "/";
  if (!message) return Response.json({ ok: false }, { status: 400 });
  if (!allowed(await clientIp(), Date.now())) return Response.json({ ok: false }, { status: 429 });

  const error = new Error(message);
  error.stack = text(body.stack, 12_000) || `${message}\n    (no stack)`;
  const user = await getCurrentUser().catch(() => null);
  const code = await logError(`browser ${where}`, error, { userId: user?.id ?? null });
  return Response.json({ ok: true, code });
}
