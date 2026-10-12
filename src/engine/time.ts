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
