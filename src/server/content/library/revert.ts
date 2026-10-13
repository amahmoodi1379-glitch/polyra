import { Prisma, type AdminLog, type ContentStatus, type QuestionType } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Tx } from "../kinds/types";
import { levelOrder } from "../languages";
import { isOrderList, orderEntity, orderState, writeOrder, type OrderList, type OrderState } from "../order";
import { ENGINE_ENTITY, engineDef, revertEngineRow } from "@/server/settings/engine";
import { APP_ENTITY, fieldOfLog, LANGUAGE_TEXT_ENTITY, revertGeneralRow } from "@/server/settings/general";
import { refreshDifficulty } from "../text-difficulty";
import { afterSentenceChange, targetColumns, wordColumns } from "./edit/sentences";
import { comparable, type StoredQuestion } from "./edit/texts";
import { logChange, same } from "./log";
import { childTables, setChildStatus, type ChildTable } from "./status";
import { entityOf, type LibrarySlug } from "./slugs";

/**
 * «برگردان» (PRD §13.2 «لاگ تغییرها»): puts back what a logged change replaced, as long as nothing
 * changed that item since. "Since" is checked twice: no later log row for the same item, and the item
 * still holds exactly what the change wrote (an import can change a draft without a log row). A revert
 * is itself logged and can be reverted. Deleting a draft is final, as its confirmation says.
 */

export type RevertBlock = "final" | "later" | "changed" | "gone" | "invalid";
export type RevertResult = { state: "reverted"; notes: string[] } | { state: "blocked"; reason: RevertBlock };

type Values = Record<string, unknown>;
type Delegate = {
  findUnique(args: { where: { id: number } }): Promise<Values | null>;
  update(args: { where: { id: number }; data: Values }): Promise<unknown>;
};

const slugOfEntity = Object.fromEntries(Object.entries(entityOf).map(([slug, entity]) => [entity, slug])) as Record<string, LibrarySlug>;

/** JSON columns of the content tables: null there is written as a database null. */
export const jsonColumns: Record<string, string[]> = {
  word: ["collocations"],
  sentence: [],
  grammar_unit: ["build_table", "category_sets"],
  conjugation_table: ["forms", "accepted_variants"],
  transform_item: [],
  translate_item: ["tokens"],
  text: ["speakers"],
  dialogue: ["turns"],
  errorfix_item: ["errors", "tokens"],
  writing_task: ["useful_phrases"],
  phonics_lesson: ["example_words", "minimal_pairs", "liaison_sentences"],
  sentence_target: ["accepted", "distractors", "accepted_full"],
};

const delegate = (tx: Tx, entity: string): Delegate | null => {
  const models: Record<string, unknown> = {
    word: tx.word,
    sentence: tx.sentence,
    grammar_unit: tx.grammarUnit,
    conjugation_table: tx.conjugationTable,
    transform_item: tx.transformItem,
    translate_item: tx.translateItem,
    text: tx.text,
    dialogue: tx.dialogue,
    errorfix_item: tx.errorfixItem,
    writing_task: tx.writingTask,
    phonics_lesson: tx.phonicsLesson,
  };
  return (models[entity] as Delegate | undefined) ?? null;
};

const writable = (table: string, values: Values) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === null && jsonColumns[table]?.includes(key) ? Prisma.DbNull : value]));

/**
 * Child rows an edit or a status change logs under their table's name (see `logEdit`, `changeStatus`):
 * a status change keeps only `{id, status}` of each, an edit the whole row. A revert row is read by
 * that shape, since it holds what the change it undid wrote.
 */
const childKeys = new Set<string>(["sentence_word", "sentence_target", "question", ...childTables]);
type ChildMode = "status" | "edit";
const statusShape = (value: unknown) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((entry) => entry !== null && typeof entry === "object" && Object.keys(entry).every((key) => key === "id" || key === "status"));
const modeOf = (action: string, value: unknown): ChildMode => (action === "status" || (action === "revert" && statusShape(value)) ? "status" : "edit");

/** An order row's list, language and level, read back from its entity and `entity_id` ("fr:A1"). */
function orderTarget(row: Pick<AdminLog, "entity" | "entity_id">): { list: OrderList; language: string; level: string | null } | null {
  const list = Object.entries(orderEntity).find(([, entity]) => entity === row.entity)?.[0];
  const [language, level = null] = (row.entity_id ?? "").split(":");
  if (!isOrderList(list) || !language) return null;
  return { list, language, level: level && (levelOrder as readonly string[]).includes(level) ? level : null };
}

/** Rows of «تنظیمات موتور» and «تنظیمات عمومی»: one key or field each, `{ value }` before and after. */
export const settingEntities = [ENGINE_ENTITY, APP_ENTITY, LANGUAGE_TEXT_ENTITY];
export const isSettingRow = (row: Pick<AdminLog, "entity">) => settingEntities.includes(row.entity);
const isOrderRow = (row: Pick<AdminLog, "entity" | "entity_id">) => !isSettingRow(row) && !/^\d+$/.test(row.entity_id ?? "");
const settingKnown = (row: Pick<AdminLog, "entity" | "entity_id">) =>
  row.entity === ENGINE_ENTITY ? Boolean(engineDef(row.entity_id ?? "")) : Boolean(fieldOfLog(row.entity, row.entity_id));

/** Whether a row's kind of change can be put back at all; the full check runs when it is clicked. */
export const revertible = (row: Pick<AdminLog, "action" | "entity" | "entity_id" | "before">) =>
  row.action !== "delete" &&
  row.action !== "audio" &&
  row.before !== null &&
  (isSettingRow(row) ? settingKnown(row) : isOrderRow(row) ? orderTarget(row) !== null : Boolean(slugOfEntity[row.entity]));

/** The newest log row of each item, so a page of the log can tell which rows are still the last word. */
export async function latestRows(rows: Pick<AdminLog, "entity" | "entity_id">[]) {
  if (rows.length === 0) return new Set<number>();
  const latest = await db.adminLog.groupBy({
    by: ["entity", "entity_id"],
    // Audio rows are not changes «برگردان» puts back, so they never stand in front of one.
    where: { OR: rows.map((row) => ({ entity: row.entity, entity_id: row.entity_id })), action: { not: "audio" } },
    _max: { id: true },
  });
  return new Set(latest.map((row) => row._max.id!));
}

/** Child rows as they are now, in the shape the log keeps them. */
async function currentChildren(tx: Tx, mode: ChildMode, table: string, id: number, logged: unknown): Promise<unknown> {
  const list = (logged ?? []) as { id: number }[];
  const ids = list.map((item) => item.id);
  if (mode === "status") {
    const select = { id: true, status: true } as const;
    const where = { where: { id: { in: ids } }, select };
    const rows =
      table === "sentence_target"
        ? await tx.sentenceTarget.findMany(where)
        : table === "question"
          ? await tx.question.findMany(where)
          : table === "transform_item"
            ? await tx.transformItem.findMany(where)
            : await tx.translateItem.findMany(where);
    return ids.map((childId) => rows.find((row) => row.id === childId) ?? null);
  }
  if (table === "sentence_word") return (await tx.sentenceWord.findMany({ where: { sentence_id: id }, orderBy: { position: "asc" } })).map(wordColumns);
  if (table === "sentence_target") {
    const rows = await tx.sentenceTarget.findMany({ where: { id: { in: ids } } });
    return ids.map((childId) => {
      const row = rows.find((item) => item.id === childId);
      return row ? targetColumns(row) : null;
    });
  }
  const rows = await tx.question.findMany({ where: { id: { in: ids } } });
  return ids.map((childId) => {
    const row = rows.find((item) => item.id === childId);
    return row ? comparable([row as StoredQuestion])[0] : null;
  });
}

/** Puts logged child rows back. */
async function writeChildren(tx: Tx, mode: ChildMode, table: string, item: Values, before: unknown, after: unknown) {
  if (mode === "status") return setChildStatus(tx, table as ChildTable, before as { id: number; status: ContentStatus }[]);
  const id = item.id as number;
  if (table === "sentence_word") {
    await tx.sentenceWord.deleteMany({ where: { sentence_id: id } });
    await tx.sentenceWord.createMany({ data: (before as Values[]).map((row) => ({ ...row, sentence_id: id }) as Prisma.SentenceWordCreateManyInput) });
    return;
  }
  if (table === "sentence_target") {
    for (const { id: targetId, ...columns } of before as Values[]) {
      await tx.sentenceTarget.update({ where: { id: targetId as number }, data: writable("sentence_target", columns) as Prisma.SentenceTargetUpdateInput });
    }
    return;
  }
  // Questions: the old ones come back as they were, ones the change added go away.
  const old = before as StoredQuestion[];
  const draftLike = item.status === "draft" || item.status === "needs_review";
  for (const question of old) {
    const fields = {
      track: question.track,
      set: question.set,
      order_no: question.order_no,
      type: question.type as QuestionType,
      payload: question.payload as Prisma.InputJsonValue,
      explanation_fa: question.explanation_fa,
      status: question.status,
    };
    const exists = await tx.question.findUnique({ where: { id: question.id }, select: { id: true } });
    if (exists) await tx.question.update({ where: { id: question.id }, data: fields });
    else await tx.question.create({ data: { id: question.id, language: item.language as string, text_id: id, ...fields } });
  }
  const added = (after as StoredQuestion[]).filter((question) => !old.some((item) => item.id === question.id));
  for (const question of added) {
    if (draftLike) await tx.question.delete({ where: { id: question.id } });
    else await tx.question.update({ where: { id: question.id }, data: { status: "retired" } });
  }
}

/** Puts back an item change (edit, status or an earlier revert). */
async function revertItem(tx: Tx, row: AdminLog, adminId: number): Promise<RevertResult> {
  const model = delegate(tx, row.entity);
  const id = Number(row.entity_id);
  const item = model ? await model.findUnique({ where: { id } }) : null;
  if (!model || !item) return { state: "blocked", reason: "gone" };
  const before = (row.before ?? {}) as Values;
  const after = (row.after ?? {}) as Values;
  for (const [key, value] of Object.entries(after)) {
    const now = childKeys.has(key) ? await currentChildren(tx, modeOf(row.action, value), key, id, value) : item[key];
    if (!same(now, value)) return { state: "blocked", reason: "changed" };
  }

  const columns = Object.fromEntries(Object.entries(before).filter(([key]) => !childKeys.has(key)));
  const notes: string[] = [];
  if (Object.keys(columns).length > 0) await model.update({ where: { id }, data: writable(row.entity, columns) });
  for (const key of Object.keys(before).filter((name) => childKeys.has(name))) {
    await writeChildren(tx, modeOf(row.action, before[key]), key, item, before[key], after[key]);
  }

  if (row.entity === "sentence") {
    notes.push(...(await afterSentenceChange(tx, adminId, item as never, { textChanged: "text" in before, ttsChanged: "tts_text" in before })));
    if ("text" in before || "sentence_word" in before) await refreshDifficulty(tx, { sentenceIds: [id] });
  }
  if (row.entity === "word" && "level" in before) await refreshDifficulty(tx, { wordIds: [id] });

  await logChange(tx, adminId, { action: "revert", entity: row.entity, entityId: id, before: after, after: before });
  return { state: "reverted", notes };
}

/** Puts back an order (PRD §13.6): only while the list still is exactly what that save made it. */
async function revertOrder(tx: Tx, row: AdminLog, adminId: number): Promise<RevertResult> {
  const target = orderTarget(row);
  if (!target) return { state: "blocked", reason: "gone" };
  const { list, language, level } = target;
  const now = await orderState(tx, list, language, level);
  if (!same(now, row.after)) return { state: "blocked", reason: "changed" };
  const before = row.before as OrderState;
  await writeOrder(tx, list, language, level, before);
  await logChange(tx, adminId, { action: "revert", entity: row.entity, entityId: row.entity_id!, before: now, after: before });
  return { state: "reverted", notes: [] };
}

/** Puts back one setting (PRD §9.8: «برگرد به قبل» from the log) while it holds what the change wrote. */
async function revertSetting(tx: Tx, row: AdminLog, adminId: number): Promise<RevertResult> {
  const before = (row.before as { value?: unknown } | null)?.value ?? null;
  const after = (row.after as { value?: unknown } | null)?.value ?? null;
  const field = row.entity === ENGINE_ENTITY ? null : fieldOfLog(row.entity, row.entity_id);
  const state =
    row.entity === ENGINE_ENTITY ? await revertEngineRow(tx, row.entity_id!, before, after, adminId) : field ? await revertGeneralRow(tx, field, before, after, adminId) : "gone";
  return state === "reverted" ? { state, notes: [] } : { state: "blocked", reason: state };
}

export async function revertChange(logId: number, adminId: number): Promise<RevertResult> {
  return db.$transaction(async (tx) => {
    const row = await tx.adminLog.findUnique({ where: { id: logId } });
    if (!row) return { state: "blocked" as const, reason: "gone" as const };
    if (!revertible(row)) return { state: "blocked" as const, reason: "final" as const };
    const later = await tx.adminLog.count({ where: { entity: row.entity, entity_id: row.entity_id, id: { gt: row.id } } });
    if (later > 0) return { state: "blocked" as const, reason: "later" as const };
    if (isSettingRow(row)) return revertSetting(tx, row, adminId);
    return isOrderRow(row) ? revertOrder(tx, row, adminId) : revertItem(tx, row, adminId);
  });
}
