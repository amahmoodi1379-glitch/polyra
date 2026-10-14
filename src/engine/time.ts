/**
 * Tehran calendar helpers. Days are stored in UTC and the day boundary is Tehran time with a fixed
 * +3:30 offset (PRD §15.6). The offset is a property of the calendar, not a tunable engine number.
 */
export const TEHRAN_OFFSET_MINUTES = 210;

/** The Tehran calendar date of an instant, as YYYY-MM-DD. */
export function tehranDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** The UTC instant at which a Tehran calendar day (YYYY-MM-DD) starts. */
export function tehranDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - TEHRAN_OFFSET_MINUTES * 60_000);
}

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 of a calendar date (YYYY-MM-DD). */
export const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
export const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => fromDayNumber(dayNumber(date) + days);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** The Saturday that starts the Iranian week (Saturday to Friday) a date belongs to (PRD §3.9). */
export function weekStart(date: string): string {
  const n = dayNumber(date);
  // 1970-01-01 was a Thursday, so Saturday is day 2 of the cycle.
  const sinceSaturday = (((n - 2) % 7) + 7) % 7;
  return fromDayNumber(n - sinceSaturday);
}

/** The instant a number of days after another one. */
export const plusDays = (instant: Date, days: number) => new Date(instant.getTime() + days * DAY_MS);
