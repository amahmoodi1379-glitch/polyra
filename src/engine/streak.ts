import { num, type Settings } from "./settings";
import type { EnrollmentE } from "./state";
import { addDays, dayNumber, weekStart } from "./time";

/**
 * Streak, forgiveness day and freezes (PRD §3.9). A day counts when a session other than «تمرین بیشتر»
 * is finished. A missed day is covered by the week's forgiveness day, else by a freeze, else the
 * streak breaks; a covered day keeps the streak alive without adding to it. A week (Saturday to
 * Friday) with at least `freeze.min_daily_minutes` of active learning on every day earns a freeze.
 *
 * `streakLastDate` is the last day already accounted for, finished or covered. `active` gives the
 * active seconds of a day (`daily_counter.active_sec`).
 */

export type StreakState = Pick<EnrollmentE, "streakCount" | "streakLastDate" | "streakForgivenWeek" | "streakForgivenCount" | "freezeCount" | "freezeCheckedWeek">;

export type StreakEvent = { freezeEarned: number; freezeUsed: number; forgiven: number; broken: boolean };

/** Freezes for every full week since the last check, up to `freeze.max` (PRD §3.9). */
function earnFreezes(state: StreakState, upTo: string, active: (date: string) => number, settings: Settings, event: StreakEvent): StreakState {
  const lastFull = addDays(weekStart(upTo), -7);
  let week = state.freezeCheckedWeek ? addDays(state.freezeCheckedWeek, 7) : lastFull;
  let next = { ...state };
  const need = num(settings, "freeze.min_daily_minutes") * 60;
  const max = num(settings, "freeze.max");
  for (; dayNumber(week) <= dayNumber(lastFull); week = addDays(week, 7)) {
    const full = Array.from({ length: 7 }, (_, i) => addDays(week, i)).every((date) => active(date) >= need);
    if (full && next.freezeCount < max) {
      next = { ...next, freezeCount: next.freezeCount + 1 };
      event.freezeEarned += 1;
    }
    next.freezeCheckedWeek = week;
  }
  return next;
}

/** Covers or breaks every missed day before `today` (the days are not finished). */
export function catchUp(state: StreakState, today: string, active: (date: string) => number, settings: Settings): { state: StreakState; event: StreakEvent } {
  const event: StreakEvent = { freezeEarned: 0, freezeUsed: 0, forgiven: 0, broken: false };
  let next = { ...state };
  if (!next.streakLastDate || next.streakCount === 0) {
    next = earnFreezes(next, today, active, settings, event);
    return { state: next, event };
  }
  const perWeek = num(settings, "streak.forgive_per_week");
  for (let day = addDays(next.streakLastDate, 1); dayNumber(day) < dayNumber(today); day = addDays(day, 1)) {
    // A freeze earned by the week that ended before this day can already cover it.
    next = earnFreezes(next, day, active, settings, event);
    const week = weekStart(day);
    const used = next.streakForgivenWeek === week ? next.streakForgivenCount : 0;
    if (used < perWeek) {
      next = { ...next, streakForgivenWeek: week, streakForgivenCount: used + 1, streakLastDate: day };
      event.forgiven += 1;
    } else if (next.freezeCount > 0) {
      next = { ...next, freezeCount: next.freezeCount - 1, streakLastDate: day };
      event.freezeUsed += 1;
    } else {
      next = { ...next, streakCount: 0, streakLastDate: null };
      event.broken = true;
      break;
    }
  }
  next = earnFreezes(next, today, active, settings, event);
  return { state: next, event };
}

/** A session that counts for the streak was finished today. */
export function finishDay(state: StreakState, today: string, active: (date: string) => number, settings: Settings): { state: StreakState; event: StreakEvent } {
  const caught = catchUp(state, today, active, settings);
  let next = caught.state;
  if (next.streakLastDate !== today) next = { ...next, streakCount: next.streakCount + 1, streakLastDate: today };
  return { state: next, event: caught.event };
}

/** Whether today's session is already done, for the faded counter on the home screen (PRD §3.9). */
export const doneToday = (state: StreakState, today: string) => state.streakLastDate === today && state.streakCount > 0;
