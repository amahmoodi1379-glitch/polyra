import { findUserByToken } from "@/server/auth/devices";
import { SESSION_COOKIE } from "@/server/auth/session";
import { db } from "@/server/db";
import { logError } from "@/server/errors";

/** Digests already logged in the last few seconds: one failed render can be reported twice (RSC and HTML). */
const recent = new Map<string, number>();
const REPEAT_MS = 5000;

/**
 * A server error the app did not catch itself, from `onRequestError` (PRD §15.9). A render error is
 * coded from its digest, which is all the browser's error screen knows of it, so the learner and the
 * errors page show the same code.
 */
export async function recordRequestError(error: unknown, headers: Record<string, string | string[] | undefined>, place: { routeType: string; routePath: string }) {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  // Redirects and «not found» travel as errors but are not failures.
  if (digest?.startsWith("NEXT_")) return;
  if (leftEarly(error)) return;
  if (digest) {
    const now = Date.now();
    for (const [key, at] of recent) if (now - at > REPEAT_MS) recent.delete(key);
    if (recent.has(digest)) return;
    recent.set(digest, now);
  }
  const userId = await signedInUser(headers.cookie).catch(() => null);
  await logError(`${place.routeType} ${place.routePath}`, error, { userId, requestId: digest, seed: digest ?? undefined });
}

/**
 * The browser stopped listening before the page was fully sent: the teacher clicked elsewhere, closed
 * the tab, or the connection dropped. Nothing in our code failed, so it is not an error to fix.
 */
export function leftEarly(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return /^The destination stream closed early\.?$/.test(message) || message === "aborted" || code === "ECONNRESET" || code === "ERR_STREAM_PREMATURE_CLOSE";
}

/** Who was signed in, from the request's cookie header, so the errors page can say whose screen it was. */
async function signedInUser(header: string | string[] | undefined): Promise<number | null> {
  const token = [header ?? []]
    .flat()
    .join("; ")
    .split(/;\s*/)
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  return (await findUserByToken({ db, now: new Date() }, decodeURIComponent(token)))?.user.id ?? null;
}
