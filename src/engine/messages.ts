import { num, type Settings } from "./settings";
import { plusDays } from "./time";

/**
 * The messages the end of a session can carry (PRD §3.11), highest priority first: a level lower,
 * shorter sessions, longer ones for long texts, the skip test, phonics set aside, slow pace, install.
 */
export const SESSION_MESSAGES = ["leveldown", "shorter", "longer", "skipTest", "phonicsOff", "slowPace", "install"] as const;
export type SessionMessageKind = (typeof SESSION_MESSAGES)[number];

/** At most one message at the end of a session: the highest of those that apply (PRD §3.11, T80). */
export function pickSessionMessage<T extends { kind: SessionMessageKind }>(applying: readonly T[]): T | null {
  const rank = (message: T) => SESSION_MESSAGES.indexOf(message.kind);
  return applying.reduce<T | null>((best, message) => (best === null || rank(message) < rank(best) ? message : best), null);
}

export type ClosedSession = { endReason: "finished" | "expired" | "replaced" | null; doneCount: number; plannedCount: number };

/**
 * Sessions left one after another (PRD §10.8): the last `abandon.sessions` sessions before this one,
 * newest first, each closed by time or by another button with fewer than half its cards done.
 */
export function leftInARow(previous: readonly ClosedSession[], settings: Settings): boolean {
  const run = previous.slice(0, num(settings, "abandon.sessions"));
  return (
    run.length === num(settings, "abandon.sessions") &&
    run.every((session) => (session.endReason === "expired" || session.endReason === "replaced") && session.doneCount * 2 < session.plannedCount)
  );
}

/** «جلسه‌ها را کوتاه‌تر کنم؟» comes at most once in `abandon.cooldown_days` (PRD §3.11 row 2). */
export const mayOfferShorter = (askedAt: Date | null, now: Date, settings: Settings) =>
  askedAt === null || plusDays(askedAt, num(settings, "abandon.cooldown_days")) <= now;

/** One step shorter (PRD §3.11 row 2: 30, 20, 15, 10), or null when the session is the shortest already. */
export function shorterLength(minutes: number, lengths: readonly number[]): number | null {
  const below = lengths.filter((length) => length < minutes);
  return below.length > 0 ? Math.max(...below) : null;
}
