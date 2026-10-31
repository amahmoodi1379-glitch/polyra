import { Prisma } from "@/generated/prisma/client";
import { changes, logChange, same } from "../library/log";
import { problem } from "../problems";
import type { EntityRef, RoundResult } from "../report";
import type { Tx } from "./types";

/** Log actions that are a person's own change to an item, and the ones an import writes. */
const BY_HAND = ["edit", "revert"];
const BY_IMPORT = ["import", "batch"];
/** Columns every import writes to say where an item came from; they are not content. */
const TRACE = new Set(["prompt_version", "model_name", "import_batch_id"]);

const keysOf = (value: Prisma.JsonValue | null) => (value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : []);
/** Prisma's JSON null markers compare as null. */
const comparable = (value: unknown) => (value === Prisma.DbNull || value === Prisma.JsonNull ? null : value);

/**
 * The columns of each item that an admin changed by hand (an edit or a revert in the change log)
 * and no import has written since. Items with none are left out of the map.
 */
export async function handEdits(tx: Tx, entity: EntityRef["type"], ids: number[]): Promise<Map<number, Set<string>>> {
  const edited = new Map<number, Set<string>>();
  if (ids.length === 0) return edited;
  const rows = await tx.adminLog.findMany({
    where: { entity, entity_id: { in: ids.map(String) }, action: { in: [...BY_HAND, ...BY_IMPORT] } },
    orderBy: { id: "asc" },
    select: { entity_id: true, action: true, before: true, after: true },
  });
  for (const row of rows) {
    const id = Number(row.entity_id);
    const keys = edited.get(id) ?? new Set<string>();
    for (const key of new Set([...keysOf(row.before), ...keysOf(row.after)])) {
      if (BY_HAND.includes(row.action)) keys.add(key);
      else keys.delete(key);
    }
    edited.set(id, keys);
  }
  for (const [id, keys] of edited) if (keys.size === 0) edited.delete(id);
  return edited;
}

/** True when any of these items (the sentences of a text, say) was changed by hand since its last import. */
export async function anyHandEdited(tx: Tx, entity: EntityRef["type"], ids: number[]) {
  return (await handEdits(tx, entity, ids)).size > 0;
}

export type Onto = {
  by: number | null;
  round: RoundResult;
  label: string;
  ref: EntityRef;
  /** Columns changed by hand (from `handEdits`). */
  edited?: Set<string>;
  /** Columns that only make sense together: when one was changed by hand, the whole group stays. */
  groups?: string[][];
  /** Report names of columns whose own name means nothing to an admin (concept_id: concept_fa). */
  names?: Record<string, string>;
  /** Parts the caller kept itself (a text's sentences) because they differ from the answer. */
  kept?: string[];
};

/**
 * What an import writes onto an item that is already there (owner decision, DECISIONS.md): columns
 * an admin changed by hand stay as they are, and the report says where the new answer differs. The
 * columns it does change are logged (PRD §13.1). `changed` is false when the item stays as it was,
 * and then the trace columns are not rewritten either.
 */
export async function importOnto<T extends Record<string, unknown>>(tx: Tx, onto: Onto, current: Record<string, unknown>, data: T) {
  const held = new Set(onto.edited ?? []);
  for (const group of onto.groups ?? []) if (group.some((key) => held.has(key))) for (const key of group) held.add(key);

  const write: Record<string, unknown> = {};
  const content: Record<string, unknown> = {};
  const kept = [...(onto.kept ?? [])];
  for (const [key, value] of Object.entries(data)) {
    if (TRACE.has(key)) write[key] = value;
    else if (!held.has(key)) {
      write[key] = value;
      content[key] = comparable(value);
    } else if (!same(comparable(current[key]), comparable(value))) kept.push(onto.names?.[key] ?? key);
  }
  if (kept.length > 0) onto.round.warnings.push({ label: onto.label, problem: problem("handEditKept", { fields: kept.join(",") }), entity: onto.ref });

  const diff = changes(
    Object.fromEntries(Object.keys(content).map((key) => [key, comparable(current[key])])),
    content,
  );
  if (diff) await logChange(tx, onto.by, { action: "batch", entity: onto.ref.type, entityId: onto.ref.id, ...diff });
  return { data: write as Partial<T>, changed: diff !== null, kept };
}

/**
 * `importOnto` for an item that is one row: writes what may be written, counts the item as updated
 * or as left as it was, and returns the row as it is now.
 */
export async function updateImported<R extends { id: number }, T extends Record<string, unknown>>(
  tx: Tx,
  onto: Omit<Onto, "edited">,
  existing: R,
  data: T,
  update: (data: Partial<T>) => Promise<R>,
): Promise<R> {
  const edited = (await handEdits(tx, onto.ref.type, [existing.id])).get(existing.id);
  const result = await importOnto(tx, { ...onto, edited }, existing as Record<string, unknown>, data);
  if (result.changed) onto.round.updated++;
  else onto.round.skipped++;
  return result.changed ? update(result.data) : existing;
}
