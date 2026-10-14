import { num, type Settings } from "./settings";
import type { NotebookE, NotebookRef } from "./state";
import { plusDays } from "./time";

/**
 * The mistakes notebook (PRD §9.5): entries are made or refreshed by a wrong answer, counted down by
 * right answers on different days, and dropped after `notebook.days` or when the item becomes a
 * leech (§9.9).
 */

export type NotebookOp =
  /** A wrong or «نمی‌دانم» answer: make the entry or start it over. */
  | { op: "wrong"; refType: NotebookRef; refId: number }
  /** A right answer: counts towards leaving the notebook (DECISIONS.md: any right answer counts). */
  | { op: "correct"; refType: NotebookRef; refId: number }
  /** The item became a leech: its entries go. */
  | { op: "remove"; refType: NotebookRef; refId: number };

const same = (entry: NotebookE, refType: NotebookRef, refId: number) => entry.refType === refType && entry.refId === refId;

/** Entries still open at `now`; an entry whose `until` passed has left the notebook. */
export const openEntries = (entries: readonly NotebookE[], now: Date) => entries.filter((entry) => Date.parse(entry.until) > now.getTime());

export function applyNotebook(entries: readonly NotebookE[], ops: readonly NotebookOp[], now: Date, today: string, settings: Settings): NotebookE[] {
  let list = openEntries(entries, now);
  const until = plusDays(now, num(settings, "notebook.days")).toISOString();
  for (const op of ops) {
    const found = list.find((entry) => same(entry, op.refType, op.refId));
    if (op.op === "remove") {
      list = list.filter((entry) => !same(entry, op.refType, op.refId));
    } else if (op.op === "wrong") {
      const fresh: NotebookE = { refType: op.refType, refId: op.refId, addedAt: found?.addedAt ?? now.toISOString(), until, correctCount: 0, lastCorrectDate: null };
      if (found) {
        list = list.map((entry) => (entry === found ? fresh : entry));
      } else {
        // A full notebook drops its oldest entry (PRD §9.5, `notebook.max`).
        const max = num(settings, "notebook.max");
        if (list.length >= max) {
          const sorted = [...list].sort((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt));
          const drop = new Set(sorted.slice(0, list.length - max + 1));
          list = list.filter((entry) => !drop.has(entry));
        }
        list = [...list, fresh];
      }
    } else if (found && found.lastCorrectDate !== today) {
      const count = found.correctCount + 1;
      list =
        count >= num(settings, "notebook.exit_correct")
          ? list.filter((entry) => entry !== found)
          : list.map((entry) => (entry === found ? { ...entry, correctCount: count, lastCorrectDate: today } : entry));
    }
  }
  return list;
}

/** Notebook practice order (PRD §10.2, step 5): fewest right answers first, then the newest mistake. */
export const notebookOrder = (entries: readonly NotebookE[]) =>
  [...entries].sort((a, b) => a.correctCount - b.correctCount || Date.parse(b.until) - Date.parse(a.until) || Date.parse(b.addedAt) - Date.parse(a.addedAt));
