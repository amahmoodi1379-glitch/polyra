import type { ItemStateE } from "./state";
import { flag, num, type Settings } from "./settings";

/**
 * «حالت پیش‌آزمون» (PRD §11.5, `pretestMode` of §15.3): whether new words come first as a W1a test.
 *
 * The input is the learner's words shown as new, newest first, each as what happened to it: «این را بلدم»,
 * a «پیش‌آزمون» right or wrong, or a plain intro card.
 * - On: at least `pretest.trigger_count` «این را بلدم» among the last `pretest.window` new words. Only the
 *   words after the newest «پیش‌آزمون» count, so a mode that just turned off needs new presses to come back.
 * - Off: fewer than `pretest.off_below` right among the last `pretest.window` «پیش‌آزمون»s after the newest
 *   «این را بلدم» (the ones since the mode came on), once at least half the window has been asked, so one
 *   unlucky first answer does not end it (DECISIONS.md, 3 November 2026).
 * - Never turns on while `feature.pretest` is off (T102).
 */

export type NewWordEvent = "iknow" | "pretest_ok" | "pretest_fail" | "word";

export function pretestModeAfter(on: boolean, recent: NewWordEvent[], settings: Settings): boolean {
  const window = num(settings, "pretest.window");
  if (on) {
    const cut = recent.indexOf("iknow");
    const sinceOn = cut < 0 ? recent : recent.slice(0, cut);
    const asked = sinceOn.filter((event) => event === "pretest_ok" || event === "pretest_fail").slice(0, window);
    if (asked.length * 2 < window) return true;
    return asked.filter((event) => event === "pretest_ok").length / asked.length >= num(settings, "pretest.off_below");
  }
  if (!flag(settings, "feature.pretest")) return false;
  const words = recent.slice(0, window);
  const last = words.findIndex((event) => event === "pretest_ok" || event === "pretest_fail");
  const counted = last < 0 ? words : words.slice(0, last);
  return counted.filter((event) => event === "iknow").length >= num(settings, "pretest.trigger_count");
}

/**
 * The learner's new words as events, newest first, from their states (placement words are not shown as
 * new) and the words whose «پیش‌آزمون» was wrong.
 */
export function newWordEvents(items: Pick<ItemStateE, "itemType" | "itemId" | "source" | "introducedAt">[], pretestFailed: ReadonlySet<number>): NewWordEvent[] {
  return items
    .filter((item) => item.itemType === "word" && item.source !== "placement" && item.introducedAt)
    .sort((a, b) => Date.parse(b.introducedAt!) - Date.parse(a.introducedAt!) || b.itemId - a.itemId)
    .map((item) => (item.source === "i_know" ? "iknow" : item.source === "pretest" ? "pretest_ok" : pretestFailed.has(item.itemId) ? "pretest_fail" : "word"));
}
