import type { FsrsCard } from "@/engine/fsrs";
import type { LanguageCode } from "@/server/content/languages";
import { db } from "@/server/db";
import { TRAVEL_DAYS } from "@/lib/travel";
import { learnContext, openSession, closeSession, type Learner } from "./session";

/**
 * «جلو بردن زمان» for testers and teachers (DECISIONS.md, 2 November 2026): N days pass for this account in
 * one language without any activity. Nothing in the engine changes: every date of the account's learning
 * rows moves N days back, so the next session sees the reviews, notebook, streak and texts of N days
 * later. An open session is closed first, as it would be after a day away.
 */

/** Rows with their own `user_id` and `language`. */
const ownTables = [
  "enrollment",
  "skill_level",
  "item_state",
  "confusion_pair",
  "notebook_entry",
  "new_word_queue",
  "daily_counter",
  "session",
  "review_log",
  "placement_run",
  "level_exam",
  "user_notice",
] as const;

/** Rows keyed by a content id; the language is the content's. */
const contentTables = [
  { table: "text_state", key: "text_id", content: "text" },
  { table: "phonics_state", key: "lesson_id", content: "phonics_lesson" },
  { table: "sentence_drill_state", key: "sentence_id", content: "sentence" },
  { table: "speak_state", key: "sentence_id", content: "sentence" },
  { table: "dialogue_state", key: "dialogue_id", content: "dialogue" },
  { table: "errorfix_state", key: "errorfix_item_id", content: "errorfix_item" },
  { table: "writing_entry", key: "writing_task_id", content: "writing_task" },
] as const;

const DAY_MS = 86_400_000;


/** Every timestamp and date column of a table, read from the database so a new column moves too. */
async function dateColumns(table: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table}
      AND data_type IN ('date', 'timestamp with time zone', 'timestamp without time zone')`;
  return rows.map((row) => row.column_name);
}

const back = (iso: string | null, days: number) => (iso ? new Date(Date.parse(iso) - days * DAY_MS).toISOString() : iso);

export async function travelDays(user: Learner, language: LanguageCode, days: number, now = new Date()) {
  if (!user.is_tester && !user.is_admin) throw new Error("Only a tester can move time");
  if (!(TRAVEL_DAYS as readonly number[]).includes(days)) throw new Error(`Moving ${days} days is not allowed`);

  const open = await openSession(user.id, language);
  if (open) await closeSession(open, "expired", now, await learnContext(user, language, now));

  const interval = `${days} days`;
  const columns = new Map<string, string[]>();
  for (const table of [...ownTables, ...contentTables.map((row) => row.table)]) columns.set(table, await dateColumns(table));
  const set = (table: string, alias = "") =>
    columns
      .get(table)!
      .map((column) => `"${column}" = ${alias}"${column}" - $3::interval`)
      .join(", ");

  const items = await db.itemState.findMany({ where: { user_id: user.id, language }, select: { id: true, fsrs: true } });
  await db.$transaction(async (tx) => {
    for (const table of ownTables) {
      if (columns.get(table)!.length === 0) continue;
      await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${set(table)} WHERE user_id = $1 AND language = $2`, user.id, language, interval);
    }
    for (const { table, key, content } of contentTables) {
      if (columns.get(table)!.length === 0) continue;
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" s SET ${set(table, "s.")} FROM "${content}" c WHERE c.id = s."${key}" AND s.user_id = $1 AND c.language = $2`,
        user.id,
        language,
        interval,
      );
    }
    // FSRS keeps its own due and last review inside the JSON (PRD §9.1).
    for (const item of items) {
      const card = item.fsrs as unknown as FsrsCard;
      const moved = { ...card, due: back(card.due, days)!, last_review: back(card.last_review, days) };
      await tx.itemState.update({ where: { id: item.id }, data: { fsrs: moved as unknown as object } });
    }
  });
}
