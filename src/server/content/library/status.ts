import type { ContentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Tx } from "../kinds/types";
import { logChange } from "./log";
import { entityOf, type LibrarySlug, type StatusAction } from "./slugs";

type Row = { id: number; status: ContentStatus; suspended: boolean };
type Delegate = {
  findMany(args: { where: { id: { in: number[] }; language: string }; select: { id: true; status: true; suspended: true } }): Promise<Row[]>;
  update(args: { where: { id: number }; data: { status?: ContentStatus; suspended?: boolean } }): Promise<unknown>;
};

const delegate = (tx: Tx, slug: LibrarySlug): Delegate => {
  const models = {
    words: tx.word,
    sentences: tx.sentence,
    units: tx.grammarUnit,
    tables: tx.conjugationTable,
    transforms: tx.transformItem,
    translations: tx.translateItem,
    texts: tx.text,
    dialogues: tx.dialogue,
    errorfix: tx.errorfixItem,
    writing: tx.writingTask,
    phonics: tx.phonicsLesson,
  };
  return models[slug] as unknown as Delegate;
};

/** Child rows that are retired with their parent (PRD §13.7), by the table they live in. */
export const childTables = ["sentence_target", "question", "transform_item", "translate_item"] as const;
export type ChildTable = (typeof childTables)[number];
type ChildRow = { id: number; status: ContentStatus };

export type Refusal = { id: number; reason: "published" | "retired" | "skeleton" | "sentenceInUse" };
export type StatusResult = { changed: number; unchanged: number; refused: Refusal[] };

/** Where a sentence is used besides its own targets: texts, dialogues and grammar unit examples. */
export async function sentenceUses(tx: Tx, language: string, ids: number[]) {
  const wanted = new Set(ids);
  const [texts, dialogues, units] = await Promise.all([
    tx.text.findMany({ where: { language, sentence_ids: { hasSome: ids } }, select: { id: true, sentence_ids: true } }),
    tx.dialogue.findMany({ where: { language }, select: { id: true, turns: true } }),
    tx.grammarUnit.findMany({ where: { language, example_sentence_ids: { hasSome: ids } }, select: { id: true, example_sentence_ids: true } }),
  ]);
  const used = new Map<number, { texts: number[]; dialogues: number[]; units: number[] }>();
  const add = (sentenceId: number, kind: "texts" | "dialogues" | "units", ownerId: number) => {
    if (!wanted.has(sentenceId)) return;
    const entry = used.get(sentenceId) ?? { texts: [], dialogues: [], units: [] };
    if (!entry[kind].includes(ownerId)) entry[kind].push(ownerId);
    used.set(sentenceId, entry);
  };
  for (const text of texts) for (const id of text.sentence_ids) add(id, "texts", text.id);
  for (const unit of units) for (const id of unit.example_sentence_ids) add(id, "units", unit.id);
  for (const dialogue of dialogues) {
    for (const turn of (dialogue.turns ?? []) as { sentence_id?: number; choices?: { sentence_id?: number }[] }[]) {
      if (turn.sentence_id) add(turn.sentence_id, "dialogues", dialogue.id);
      for (const choice of turn.choices ?? []) if (choice.sentence_id) add(choice.sentence_id, "dialogues", dialogue.id);
    }
  }
  return used;
}

/** Child rows that go with an item when it is retired: a word's or a unit's targets, a text's questions. */
async function children(tx: Tx, slug: LibrarySlug, id: number): Promise<Partial<Record<ChildTable, ChildRow[]>>> {
  const live = { status: { not: "retired" as const } };
  const select = { id: true, status: true } as const;
  switch (slug) {
    case "words":
      return { sentence_target: await tx.sentenceTarget.findMany({ where: { target_type: "word", target_id: id, ...live }, select }) };
    case "sentences":
      return { sentence_target: await tx.sentenceTarget.findMany({ where: { sentence_id: id, ...live }, select }) };
    case "units":
      return {
        sentence_target: await tx.sentenceTarget.findMany({ where: { target_type: "grammar", target_id: id, ...live }, select }),
        transform_item: await tx.transformItem.findMany({ where: { grammar_unit_id: id, ...live }, select }),
        translate_item: await tx.translateItem.findMany({ where: { grammar_unit_id: id, ...live }, select }),
      };
    case "texts":
      return { question: await tx.question.findMany({ where: { text_id: id, ...live }, select }) };
    default:
      return {};
  }
}

/** Sets the status of child rows, one table at a time. */
export async function setChildStatus(tx: Tx, table: ChildTable, rows: ChildRow[]) {
  for (const status of new Set(rows.map((row) => row.status))) {
    const ids = rows.filter((row) => row.status === status).map((row) => row.id);
    const where = { id: { in: ids } };
    if (table === "sentence_target") await tx.sentenceTarget.updateMany({ where, data: { status } });
    if (table === "question") await tx.question.updateMany({ where, data: { status } });
    if (table === "transform_item") await tx.transformItem.updateMany({ where, data: { status } });
    if (table === "translate_item") await tx.translateItem.updateMany({ where, data: { status } });
  }
}

/** A word list skeleton (no meaning) or a unit without its lesson cannot be approved yet. */
async function skeletons(tx: Tx, slug: LibrarySlug, ids: number[]) {
  if (slug === "words") return new Set((await tx.word.findMany({ where: { id: { in: ids }, meaning_fa: null }, select: { id: true } })).map((row) => row.id));
  if (slug === "units") return new Set((await tx.grammarUnit.findMany({ where: { id: { in: ids }, lesson_fa: null }, select: { id: true } })).map((row) => row.id));
  return new Set<number>();
}

/**
 * Approve, back to draft, suspend, unsuspend or retire some items of one type (PRD §13.2, §13.7).
 * Publishing happens in «انتشار» with its checks; a published item can only be suspended or retired
 * here. Retiring takes its targets or questions with it; a sentence inside a text, a dialogue or a
 * unit's examples is not retired on its own. Each change is one `admin_log` row.
 */
export async function changeStatus(slug: LibrarySlug, language: string, ids: number[], action: StatusAction, adminId: number | null): Promise<StatusResult> {
  return db.$transaction(async (tx) => {
    const model = delegate(tx, slug);
    const rows = await model.findMany({ where: { id: { in: ids }, language }, select: { id: true, status: true, suspended: true } });
    const result: StatusResult = { changed: 0, unchanged: 0, refused: [] };
    const blocked = slug === "sentences" && action === "retire" ? await sentenceUses(tx, language, rows.map((row) => row.id)) : new Map();
    const empty = action === "approve" ? await skeletons(tx, slug, rows.map((row) => row.id)) : new Set<number>();

    for (const row of rows) {
      let data: { status?: ContentStatus; suspended?: boolean } | null = null;
      if (action === "suspend" || action === "unsuspend") {
        const suspended = action === "suspend";
        if (row.status === "retired") result.refused.push({ id: row.id, reason: "retired" });
        else if (row.suspended !== suspended) data = { suspended };
      } else if (row.status === "retired") {
        if (action !== "retire") result.refused.push({ id: row.id, reason: "retired" });
      } else if (action === "retire") {
        if (blocked.has(row.id)) result.refused.push({ id: row.id, reason: "sentenceInUse" });
        else data = { status: "retired" };
      } else if (row.status === "published") {
        result.refused.push({ id: row.id, reason: "published" });
      } else if (action === "approve") {
        if (empty.has(row.id)) result.refused.push({ id: row.id, reason: "skeleton" });
        else if (row.status !== "approved") data = { status: "approved" };
      } else if (row.status !== "draft") {
        data = { status: "draft" };
      }

      if (!data) {
        if (!result.refused.some((item) => item.id === row.id)) result.unchanged++;
        continue;
      }
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        before[key] = row[key];
        after[key] = data[key];
      }
      if (data.status === "retired") {
        for (const [table, list] of Object.entries(await children(tx, slug, row.id)) as [ChildTable, ChildRow[]][]) {
          if (list.length === 0) continue;
          before[table] = list;
          after[table] = list.map((child) => ({ id: child.id, status: "retired" }));
          await setChildStatus(tx, table, after[table] as ChildRow[]);
        }
      }
      await model.update({ where: { id: row.id }, data });
      await logChange(tx, adminId, { action: "status", entity: entityOf[slug], entityId: row.id, before, after });
      result.changed++;
    }
    return result;
  });
}
