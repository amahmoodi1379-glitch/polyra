import type { Prisma } from "@/generated/prisma/client";
import { backupTables, prismaQuerier, quote, rowInsert, rowSelect, type BackupTable } from "@/server/backup/tables";
import { db } from "@/server/db";
import type { MappedRow } from "@/engine/tokens";
import type { Tx } from "../kinds/types";
import { rearrangeLevel } from "../intro-order";
import { refreshSentenceLevels } from "../sentence-level";
import { refreshDifficulty } from "../text-difficulty";
import { logChange, plain, same } from "./log";
import { entityOf, type LibrarySlug } from "./slugs";
import { sentenceUses } from "./status";

/**
 * Deleting items of «همه محتوا» in any status, many at once (owner's choice, DECISIONS.md): what exists
 * only for them goes with them (a word's practice sentences made for it, a text's questions and
 * sentences, a unit's targets and exercises, learners' progress on them); where something else still
 * uses a deleted word, it becomes a «کاندید» there. Every row taken out and every row changed is kept in
 * `removed_rows`, so «برگردان» in the change log puts all of it back exactly.
 *
 * A sentence inside a text or a dialogue is not deleted on its own: the text or dialogue is edited or
 * deleted instead (PRD §13.7).
 */

type Updatable = "word" | "sentence_word" | "text" | "translate_item" | "errorfix_item" | "grammar_unit";
type RowValues = Record<string, unknown>;

/** What one deletion takes out (table → ids) and changes (table → id → new values). */
class Plan {
  deletes = new Map<string, Set<number>>();
  updates = new Map<Updatable, Map<number, RowValues>>();
  del(table: string, ids: Iterable<number>) {
    const set = this.deletes.get(table) ?? new Set<number>();
    for (const id of ids) set.add(id);
    this.deletes.set(table, set);
  }
  has(table: string, id: number) {
    return this.deletes.get(table)?.has(id) ?? false;
  }
  ids(table: string) {
    return [...(this.deletes.get(table) ?? [])];
  }
  upd(table: Updatable, id: number, values: RowValues) {
    const rows = this.updates.get(table) ?? new Map<number, RowValues>();
    rows.set(id, { ...(rows.get(id) ?? {}), ...values });
    this.updates.set(table, rows);
  }
  count(table: string) {
    return this.deletes.get(table)?.size ?? 0;
  }
}

const idsOf = (rows: { id: number }[]) => rows.map((row) => row.id);
const unique = (ids: number[]) => [...new Set(ids)];

/** Learners' rows about these items, so nothing points at a deleted item. */
async function learnerRows(tx: Tx, plan: Plan, language: string) {
  const words = plan.ids("word");
  const units = plan.ids("grammar_unit");
  const tables = plan.ids("conjugation_table");
  const targets = plan.ids("sentence_target");
  const sentences = plan.ids("sentence");
  const items = [
    ...(words.length ? [{ item_type: "word" as const, item_id: { in: words } }] : []),
    ...(units.length ? [{ item_type: "grammar_unit" as const, item_id: { in: units } }] : []),
    ...(tables.length ? [{ item_type: "conjugation" as const, item_id: { in: tables } }] : []),
  ];
  if (items.length) plan.del("item_state", idsOf(await tx.itemState.findMany({ where: { language, OR: items }, select: { id: true } })));
  const notes = [
    ...(words.length ? [{ ref_type: { in: ["word" as const, "word_gender" as const] }, ref_id: { in: words } }] : []),
    ...(tables.length ? [{ ref_type: "conjugation" as const, ref_id: { in: tables } }] : []),
    ...(targets.length ? [{ ref_type: "grammar_target" as const, ref_id: { in: targets } }] : []),
  ];
  if (notes.length) plan.del("notebook_entry", idsOf(await tx.notebookEntry.findMany({ where: { language, OR: notes }, select: { id: true } })));
  if (words.length) {
    plan.del("new_word_queue", idsOf(await tx.newWordQueue.findMany({ where: { word_id: { in: words } }, select: { id: true } })));
    plan.del(
      "confusion_pair",
      idsOf(await tx.confusionPair.findMany({ where: { OR: [{ word_id: { in: words } }, { other_word_id: { in: words } }] }, select: { id: true } })),
    );
  }
  if (sentences.length) {
    plan.del("sentence_drill_state", idsOf(await tx.sentenceDrillState.findMany({ where: { sentence_id: { in: sentences } }, select: { id: true } })));
    plan.del("speak_state", idsOf(await tx.speakState.findMany({ where: { sentence_id: { in: sentences } }, select: { id: true } })));
  }
  const states: [string, number[], () => Promise<{ id: number }[]>][] = [
    ["text_state", plan.ids("text"), () => tx.textState.findMany({ where: { text_id: { in: plan.ids("text") } }, select: { id: true } })],
    ["dialogue_state", plan.ids("dialogue"), () => tx.dialogueState.findMany({ where: { dialogue_id: { in: plan.ids("dialogue") } }, select: { id: true } })],
    ["errorfix_state", plan.ids("errorfix_item"), () => tx.errorfixState.findMany({ where: { errorfix_item_id: { in: plan.ids("errorfix_item") } }, select: { id: true } })],
    ["writing_entry", plan.ids("writing_task"), () => tx.writingEntry.findMany({ where: { writing_task_id: { in: plan.ids("writing_task") } }, select: { id: true } })],
    ["phonics_state", plan.ids("phonics_lesson"), () => tx.phonicsState.findMany({ where: { lesson_id: { in: plan.ids("phonics_lesson") } }, select: { id: true } })],
  ];
  for (const [table, owners, find] of states) if (owners.length) plan.del(table, idsOf(await find()));

  // Reports about items that are gone (PRD §13.10).
  const reportTypes: [string, string][] = [
    ["word", "word"],
    ["grammar_unit", "grammar_unit"],
    ["conjugation_table", "conjugation"],
    ["transform_item", "transform_item"],
    ["translate_item", "translate_item"],
    ["text", "text"],
    ["sentence", "sentence"],
    ["dialogue", "dialogue"],
    ["errorfix_item", "errorfix_item"],
    ["writing_task", "writing_task"],
    ["phonics_lesson", "phonics_lesson"],
  ];
  const reported = reportTypes.filter(([table]) => plan.count(table) > 0).map(([table, type]) => ({ item_type: type, item_id: { in: plan.ids(table) } }));
  if (sentences.length) reported.push({ item_type: "sentence", item_id: { in: sentences } });
  const reportWhere: Prisma.ContentReportWhereInput[] = [...reported, ...(sentences.length ? [{ sentence_id: { in: sentences } }] : [])];
  if (reportWhere.length) plan.del("content_report", idsOf(await tx.contentReport.findMany({ where: { OR: reportWhere }, select: { id: true } })));
}

/** Sentences with their word rows, targets and audio; a unit that showed one as an example keeps the others. */
async function planSentences(tx: Tx, plan: Plan, language: string, ids: number[]) {
  const fresh = unique(ids).filter((id) => !plan.has("sentence", id));
  if (fresh.length === 0) return;
  plan.del("sentence", fresh);
  plan.del("sentence_word", idsOf(await tx.sentenceWord.findMany({ where: { sentence_id: { in: fresh } }, select: { id: true } })));
  plan.del("sentence_target", idsOf(await tx.sentenceTarget.findMany({ where: { sentence_id: { in: fresh } }, select: { id: true } })));
  const audio = await tx.sentence.findMany({ where: { id: { in: fresh } }, select: { audio_id: true, human_audio_id: true } });
  plan.del("audio_asset", audio.flatMap((row) => [row.audio_id, row.human_audio_id]).filter((id): id is number => id !== null));
  const units = await tx.grammarUnit.findMany({ where: { language, example_sentence_ids: { hasSome: fresh } }, select: { id: true, example_sentence_ids: true } });
  for (const unit of units) {
    if (plan.has("grammar_unit", unit.id)) continue;
    plan.upd("grammar_unit", unit.id, { example_sentence_ids: unit.example_sentence_ids.filter((id) => !plan.has("sentence", id)) });
  }
}

/**
 * Of these sentences, the ones left with no target and used by nothing that stays (text, dialogue, unit
 * example) go too: they were made for what is deleted.
 */
async function dropLeftSentences(tx: Tx, plan: Plan, language: string, candidates: number[]) {
  const ids = unique(candidates).filter((id) => !plan.has("sentence", id));
  if (ids.length === 0) return;
  const targets = await tx.sentenceTarget.findMany({ where: { sentence_id: { in: ids } }, select: { id: true, sentence_id: true } });
  const targeted = new Set(targets.filter((target) => !plan.has("sentence_target", target.id)).map((target) => target.sentence_id));
  const uses = await sentenceUses(tx, language, ids);
  const usedByOthers = (id: number) => {
    const use = uses.get(id);
    return Boolean(use && (use.texts.some((t) => !plan.has("text", t)) || use.dialogues.some((d) => !plan.has("dialogue", d)) || use.units.some((u) => !plan.has("grammar_unit", u))));
  };
  await planSentences(
    tx,
    plan,
    language,
    ids.filter((id) => !targeted.has(id) && !usedByOthers(id)),
  );
}

/** A word's own rows; elsewhere it becomes a candidate (sentences, short translations, find-the-mistake). */
async function planWords(tx: Tx, plan: Plan, language: string, ids: number[]) {
  const words = await tx.word.findMany({ where: { id: { in: ids }, language }, select: { id: true, code: true, concept_id: true, audio_id: true, human_audio_id: true } });
  if (words.length === 0) return;
  const wordIds = idsOf(words);
  const codes = words.map((word) => word.code);
  const codeOf = new Map(words.map((word) => [word.id, word.code]));
  plan.del("word", wordIds);
  plan.del("form_exception", idsOf(await tx.formException.findMany({ where: { word_id: { in: wordIds } }, select: { id: true } })));
  plan.del("audio_asset", words.flatMap((word) => [word.audio_id, word.human_audio_id]).filter((id): id is number => id !== null));
  plan.del("conjugation_table", idsOf(await tx.conjugationTable.findMany({ where: { word_id: { in: wordIds } }, select: { id: true } })));

  const targets = await tx.sentenceTarget.findMany({ where: { target_type: "word", target_id: { in: wordIds } }, select: { id: true, sentence_id: true } });
  plan.del("sentence_target", idsOf(targets));
  await dropLeftSentences(tx, plan, language, targets.map((target) => target.sentence_id));

  const rows = await tx.sentenceWord.findMany({ where: { word_id: { in: wordIds } }, select: { id: true, sentence_id: true, word_id: true } });
  for (const row of rows) {
    if (plan.has("sentence", row.sentence_id)) continue;
    plan.upd("sentence_word", row.id, { word_id: null, candidate_reason: "missing", code_given: codeOf.get(row.word_id!) ?? null, suspect: false });
  }

  const others = await tx.word.findMany({
    where: { language, id: { notIn: wordIds }, OR: [{ sense_of: { in: codes } }, { parts: { hasSome: codes } }, { dup_of_id: { in: wordIds } }] },
    select: { id: true, sense_of: true, parts: true, dup_of_id: true },
  });
  for (const other of others) {
    const values: RowValues = {};
    if (other.sense_of && codes.includes(other.sense_of)) values.sense_of = null;
    if (other.parts.some((part) => codes.includes(part))) values.parts = other.parts.filter((part) => !codes.includes(part));
    if (other.dup_of_id !== null && codeOf.has(other.dup_of_id)) values.dup_of_id = null;
    plan.upd("word", other.id, values);
  }

  const texts = await tx.text.findMany({ where: { language, key_word_ids: { hasSome: wordIds } }, select: { id: true, key_word_ids: true } });
  for (const text of texts) plan.upd("text", text.id, { key_word_ids: text.key_word_ids.filter((id) => !codeOf.has(id)) });

  for (const table of ["translate_item", "errorfix_item"] as const) {
    const items =
      table === "translate_item"
        ? await tx.translateItem.findMany({ where: { language }, select: { id: true, tokens: true } })
        : await tx.errorfixItem.findMany({ where: { language }, select: { id: true, tokens: true } });
    for (const item of items) {
      const tokens = (item.tokens ?? []) as MappedRow[];
      if (!Array.isArray(tokens) || !tokens.some((token) => token.word_id !== null && codeOf.has(token.word_id))) continue;
      plan.upd(table, item.id, {
        tokens: tokens.map((token) =>
          token.word_id !== null && codeOf.has(token.word_id) ? { ...token, word_id: null, candidate_reason: "missing", code_given: codeOf.get(token.word_id) ?? token.code_given, suspect: false } : token,
        ),
      });
    }
  }

  const concepts = unique(words.map((word) => word.concept_id).filter((id): id is number => id !== null));
  if (concepts.length) {
    const kept = new Set(
      (await tx.word.findMany({ where: { concept_id: { in: concepts }, id: { notIn: wordIds } }, select: { concept_id: true } })).map((row) => row.concept_id),
    );
    plan.del(
      "concept",
      concepts.filter((id) => !kept.has(id)),
    );
  }
}

async function planUnits(tx: Tx, plan: Plan, language: string, ids: number[]) {
  const units = await tx.grammarUnit.findMany({ where: { id: { in: ids }, language }, select: { id: true, unit_code: true, example_sentence_ids: true } });
  if (units.length === 0) return;
  const unitIds = idsOf(units);
  const codes = units.map((unit) => unit.unit_code);
  plan.del("grammar_unit", unitIds);
  plan.del("transform_item", idsOf(await tx.transformItem.findMany({ where: { grammar_unit_id: { in: unitIds } }, select: { id: true } })));
  plan.del("translate_item", idsOf(await tx.translateItem.findMany({ where: { grammar_unit_id: { in: unitIds } }, select: { id: true } })));
  plan.del("conjugation_table", idsOf(await tx.conjugationTable.findMany({ where: { language, unit_code: { in: codes } }, select: { id: true } })));
  const targets = await tx.sentenceTarget.findMany({ where: { target_type: "grammar", target_id: { in: unitIds } }, select: { id: true, sentence_id: true } });
  plan.del("sentence_target", idsOf(targets));
  await dropLeftSentences(tx, plan, language, [...targets.map((target) => target.sentence_id), ...units.flatMap((unit) => unit.example_sentence_ids)]);

  const errorfix = await tx.errorfixItem.findMany({ where: { language, unit_codes: { hasSome: codes } }, select: { id: true, unit_codes: true } });
  for (const item of errorfix) {
    const left = item.unit_codes.filter((code) => !codes.includes(code));
    if (left.length === 0) plan.del("errorfix_item", [item.id]);
    else plan.upd("errorfix_item", item.id, { unit_codes: left });
  }
}

async function planContainers(tx: Tx, plan: Plan, slug: "texts" | "dialogues", language: string, ids: number[]) {
  if (slug === "texts") {
    const texts = await tx.text.findMany({ where: { id: { in: ids }, language }, select: { id: true, sentence_ids: true, audio_id: true, human_audio_id: true } });
    plan.del("text", idsOf(texts));
    plan.del("question", idsOf(await tx.question.findMany({ where: { text_id: { in: idsOf(texts) } }, select: { id: true } })));
    plan.del("audio_asset", texts.flatMap((text) => [text.audio_id, text.human_audio_id]).filter((id): id is number => id !== null));
    await dropLeftSentences(tx, plan, language, texts.flatMap((text) => text.sentence_ids));
    return;
  }
  const dialogues = await tx.dialogue.findMany({ where: { id: { in: ids }, language }, select: { id: true, turns: true } });
  plan.del("dialogue", idsOf(dialogues));
  const sentences = dialogues.flatMap((dialogue) =>
    ((dialogue.turns ?? []) as { sentence_id?: number; choices?: { sentence_id?: number }[] }[]).flatMap((turn) => [
      ...(turn.sentence_id ? [turn.sentence_id] : []),
      ...(turn.choices ?? []).flatMap((choice) => (choice.sentence_id ? [choice.sentence_id] : [])),
    ]),
  );
  await dropLeftSentences(tx, plan, language, sentences);
}

/** Sentences that are part of a text or a dialogue that stays. */
async function boundSentences(tx: Tx, language: string, ids: number[]) {
  const uses = await sentenceUses(tx, language, ids);
  return new Set([...uses.entries()].filter(([, use]) => use.texts.length > 0 || use.dialogues.length > 0).map(([id]) => id));
}

export type RemovalRefusal = { id: number; reason: "inText" };
export type RemovalSummary = {
  /** The items of the chosen type that would go. */
  items: number;
  published: number;
  sentences: number;
  targets: number;
  tables: number;
  questions: number;
  exercises: number;
  /** Places where a deleted word stays in a sentence and becomes «کاندید». */
  candidates: number;
  /** Learners (and test accounts) whose progress on these items is deleted. */
  learners: number;
  refused: RemovalRefusal[];
};

async function makePlan(tx: Tx, slug: LibrarySlug, language: string, ids: number[]) {
  const plan = new Plan();
  const refused: RemovalRefusal[] = [];
  const wanted = unique(ids);
  switch (slug) {
    case "words":
      await planWords(tx, plan, language, wanted);
      break;
    case "sentences": {
      const bound = await boundSentences(tx, language, wanted);
      for (const id of wanted) if (bound.has(id)) refused.push({ id, reason: "inText" });
      const mine = await tx.sentence.findMany({ where: { id: { in: wanted.filter((id) => !bound.has(id)) }, language }, select: { id: true } });
      await planSentences(tx, plan, language, idsOf(mine));
      break;
    }
    case "units":
      await planUnits(tx, plan, language, wanted);
      break;
    case "texts":
    case "dialogues":
      await planContainers(tx, plan, slug, language, wanted);
      break;
    case "tables":
      plan.del("conjugation_table", idsOf(await tx.conjugationTable.findMany({ where: { id: { in: wanted }, language }, select: { id: true } })));
      break;
    case "transforms":
      plan.del("transform_item", idsOf(await tx.transformItem.findMany({ where: { id: { in: wanted }, language }, select: { id: true } })));
      break;
    case "translations":
      plan.del("translate_item", idsOf(await tx.translateItem.findMany({ where: { id: { in: wanted }, language }, select: { id: true } })));
      break;
    case "errorfix":
      plan.del("errorfix_item", idsOf(await tx.errorfixItem.findMany({ where: { id: { in: wanted }, language }, select: { id: true } })));
      break;
    case "writing":
      plan.del("writing_task", idsOf(await tx.writingTask.findMany({ where: { id: { in: wanted }, language }, select: { id: true } })));
      break;
    case "phonics":
      plan.del("phonics_lesson", idsOf(await tx.phonicsLesson.findMany({ where: { id: { in: wanted }, language }, select: { id: true } })));
      break;
  }
  await learnerRows(tx, plan, language);
  return { plan, refused };
}

const learnerTables = ["item_state", "notebook_entry", "new_word_queue", "confusion_pair", "sentence_drill_state", "speak_state", "text_state", "dialogue_state", "errorfix_state", "writing_entry", "phonics_state"];

async function learnerCount(tx: Tx, plan: Plan) {
  const users = new Set<number>();
  for (const table of learnerTables) {
    const ids = plan.ids(table);
    if (ids.length === 0) continue;
    const rows = await tx.$queryRawUnsafe<{ user_id: number }[]>(`SELECT DISTINCT user_id FROM ${quote(table)} WHERE id = ANY($1::int[])`, ids);
    for (const row of rows) users.add(row.user_id);
  }
  return users.size;
}

async function summarize(tx: Tx, slug: LibrarySlug, plan: Plan, refused: RemovalRefusal[]): Promise<RemovalSummary> {
  const own = entityOf[slug];
  const ids = plan.ids(own);
  const published = ids.length
    ? Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${quote(own)} WHERE id = ANY($1::int[]) AND status = 'published'`, ids))[0].n)
    : 0;
  return {
    items: ids.length,
    published,
    sentences: own === "sentence" ? 0 : plan.count("sentence"),
    targets: plan.count("sentence_target"),
    tables: own === "conjugation_table" ? 0 : plan.count("conjugation_table"),
    questions: plan.count("question"),
    exercises: (own === "transform_item" ? 0 : plan.count("transform_item")) + (own === "translate_item" ? 0 : plan.count("translate_item")) + (own === "errorfix_item" ? 0 : plan.count("errorfix_item")),
    candidates: (plan.updates.get("sentence_word")?.size ?? 0) + (plan.updates.get("translate_item")?.size ?? 0) + (plan.updates.get("errorfix_item")?.size ?? 0),
    learners: await learnerCount(tx, plan),
    refused,
  };
}

/** What deleting these items would take with it, without changing anything. */
export async function previewRemoval(slug: LibrarySlug, language: string, ids: number[]): Promise<RemovalSummary> {
  return db.$transaction(
    async (tx) => {
      const { plan, refused } = await makePlan(tx, slug, language, ids);
      return summarize(tx, slug, plan, refused);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** The stored form of one deletion: every deleted row (as the backup writes rows) and every changed column. */
export type RemovedData = {
  deleted: { table: string; rows: RowValues[] }[];
  /** `stamp` is the row's `updated_at` before, put back with the old values. */
  updated: { table: Updatable; id: number; before: RowValues; after: RowValues; stamp?: string | null }[];
};

const models = (tx: Tx) =>
  ({
    word: tx.word,
    sentence_word: tx.sentenceWord,
    text: tx.text,
    translate_item: tx.translateItem,
    errorfix_item: tx.errorfixItem,
    grammar_unit: tx.grammarUnit,
  }) as unknown as Record<Updatable, { findUnique(args: { where: { id: number } }): Promise<RowValues | null>; update(args: { where: { id: number }; data: RowValues }): Promise<unknown> }>;

const jsonish = (value: unknown) => (value === null ? null : (value as Prisma.InputJsonValue));

export type RemovalResult = { state: "deleted"; summary: RemovalSummary } | { state: "nothing"; summary: RemovalSummary };

/**
 * Deletes the items and everything the plan takes with them, in one transaction, and writes one
 * change-log row («حذف») that «برگردان» can undo.
 */
export async function removeItems(slug: LibrarySlug, language: string, ids: number[], adminId: number | null): Promise<RemovalResult> {
  return db.$transaction(
    async (tx) => {
      const { plan, refused } = await makePlan(tx, slug, language, ids);
      const summary = await summarize(tx, slug, plan, refused);
      const own = entityOf[slug];
      // In the order they were chosen, so the log names the first one picked.
      const ownIds = unique(ids).filter((id) => plan.has(own, id));
      if (ownIds.length === 0) return { state: "nothing" as const, summary };

      const tables = await backupTables(prismaQuerier(tx));
      const byName = new Map(tables.map((table) => [table.name, table]));
      const data: RemovedData = { deleted: [], updated: [] };

      // Keep every row that goes, parents first, exactly as stored.
      for (const table of tables) {
        const tableIds = plan.ids(table.name);
        if (tableIds.length === 0) continue;
        const rows = await tx.$queryRawUnsafe<{ row: string }[]>(`SELECT ${rowSelect(table)} AS row FROM ${quote(table.name)} t WHERE t.id = ANY($1::int[]) ORDER BY t.id`, tableIds);
        data.deleted.push({ table: table.name, rows: rows.map((row) => JSON.parse(row.row) as RowValues) });
      }

      // Changes to rows that stay: their old values, then the new ones.
      const model = models(tx);
      for (const [table, rows] of plan.updates) {
        for (const [id, values] of rows) {
          const current = await model[table].findUnique({ where: { id } });
          if (!current) continue;
          const before: RowValues = {};
          for (const key of Object.keys(values)) before[key] = current[key];
          const stamp = current.updated_at instanceof Date ? current.updated_at.toISOString() : null;
          data.updated.push({ table, id, before: plain(before) as RowValues, after: plain(values) as RowValues, ...(stamp ? { stamp } : {}) });
          await model[table].update({
            where: { id },
            data: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key === "tokens" ? jsonish(value) : value])),
          });
        }
      }

      // Children before parents.
      for (const table of [...tables].reverse()) {
        const tableIds = plan.ids(table.name);
        if (tableIds.length) await tx.$executeRawUnsafe(`DELETE FROM ${quote(table.name)} WHERE id = ANY($1::int[])`, tableIds);
      }

      await refreshAfter(tx, data);
      const kept = await tx.removedRows.create({ data: { data: data as unknown as Prisma.InputJsonValue } });
      const first = data.deleted.find((entry) => entry.table === own)?.rows.find((row) => row.id === ownIds[0]) ?? { id: ownIds[0] };
      await logChange(tx, adminId, {
        action: "delete",
        entity: own,
        entityId: ownIds[0],
        before: { ...(plain(decodeJson(byName.get(own)!, first)) as RowValues), removed_id: kept.id, removed_ids: ownIds, removed_summary: { ...summary, refused: undefined } },
        after: null,
      });
      return { state: "deleted" as const, summary };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/**
 * What other rows derive from the changed ones: a sentence's level from its words, a text's difficulty,
 * where phrases sit in their level's order.
 */
async function refreshAfter(tx: Tx, data: RemovedData) {
  const sentenceWords = data.updated.filter((change) => change.table === "sentence_word").map((change) => change.id);
  const sentenceIds = sentenceWords.length
    ? unique((await tx.sentenceWord.findMany({ where: { id: { in: sentenceWords } }, select: { sentence_id: true } })).map((row) => row.sentence_id))
    : [];
  const textIds = data.updated.filter((change) => change.table === "text").map((change) => change.id);
  if (sentenceIds.length) await refreshSentenceLevels(tx, { sentenceIds });
  if (sentenceIds.length || textIds.length) await refreshDifficulty(tx, { sentenceIds, textIds });
  const levels = new Set<string>();
  for (const entry of data.deleted.filter((item) => item.table === "word")) for (const row of entry.rows) levels.add(`${row.language}|${row.level}`);
  for (const change of data.updated.filter((item) => item.table === "word" && "parts" in item.after)) {
    const word = await tx.word.findUnique({ where: { id: change.id }, select: { language: true, level: true } });
    if (word) levels.add(`${word.language}|${word.level}`);
  }
  for (const key of levels) {
    const [language, level] = key.split("|");
    await rearrangeLevel(tx, language, level);
  }
}

/** A snapshot row with its json columns (kept as text) read back as JSON, for showing it in the log. */
function decodeJson(table: BackupTable, row: RowValues): RowValues {
  const out = { ...row };
  for (const column of table.columns) {
    if (column.json && typeof out[column.name] === "string") out[column.name] = JSON.parse(out[column.name] as string);
  }
  return out;
}

export type RestoreRemovalResult = { state: "restored" } | { state: "gone" } | { state: "taken"; table: string; id: number };

/**
 * Puts a deletion back: every row with its own id, and every changed column that still holds what the
 * deletion wrote. Refused when something with the same id or the same unique key was made since.
 */
export async function restoreRemoval(tx: Tx, removedId: number): Promise<RestoreRemovalResult> {
  const kept = await tx.removedRows.findUnique({ where: { id: removedId } });
  if (!kept) return { state: "gone" };
  const data = kept.data as unknown as RemovedData;
  const tables = new Map((await backupTables(prismaQuerier(tx))).map((table) => [table.name, table]));

  for (const entry of data.deleted) {
    const ids = entry.rows.map((row) => row.id as number);
    const found = await tx.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM ${quote(entry.table)} WHERE id = ANY($1::int[]) LIMIT 1`, ids);
    if (found.length) return { state: "taken", table: entry.table, id: found[0].id };
  }
  try {
    await tx.$executeRawUnsafe("SAVEPOINT restore_removal");
    for (const entry of data.deleted) {
      const table = tables.get(entry.table);
      if (!table || entry.rows.length === 0) continue;
      await tx.$executeRawUnsafe(rowInsert(table), JSON.stringify(entry.rows));
    }
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT restore_removal");
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT restore_removal");
    const unique = /duplicate key|unique/i.test(String(error));
    if (!unique) throw error;
    return { state: "taken", table: "", id: 0 };
  }

  const model = models(tx);
  for (const change of data.updated) {
    const current = await model[change.table].findUnique({ where: { id: change.id } });
    if (!current) continue;
    const back: RowValues = {};
    for (const [key, value] of Object.entries(change.after)) {
      if (same(current[key], value)) back[key] = key === "tokens" ? jsonish(change.before[key]) : change.before[key];
    }
    if (Object.keys(back).length === 0) continue;
    if (change.stamp && Object.keys(back).length === Object.keys(change.after).length) back.updated_at = new Date(change.stamp);
    await model[change.table].update({ where: { id: change.id }, data: back });
  }
  await refreshAfter(tx, data);
  await tx.removedRows.delete({ where: { id: removedId } });
  return { state: "restored" };
}
