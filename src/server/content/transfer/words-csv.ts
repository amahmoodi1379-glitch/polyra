import { z } from "zod";
import type { Mastery, Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { arrange } from "@/lib/arrange";
import { parseCsv } from "@/lib/csv";
import { optionalText } from "@/schemas/common";
import { wordRecord } from "@/schemas/words";
import { db } from "@/server/db";
import { appSetting, engineNumber } from "@/server/settings/read";
import { levelWords, numberLevel } from "../intro-order";
import { checkWord } from "../kinds/words";
import type { Tx } from "../kinds/types";
import { languageInfo, levelRank, type LanguageCode } from "../languages";
import { changes, logChange, plain } from "../library/log";
import { orderEntity, orderKey } from "../order";
import { describeProblem, problem, zodProblems, type Problem } from "../problems";
import { wordCsvColumns } from "./export";

/**
 * The word file of PRD §14.7: a word list edited in a spreadsheet comes back into the panel. A row is
 * matched to a word by its code. A new code makes a draft word; a draft or a word waiting for review
 * is updated; an approved, published or retired word is not touched (PRD §14.9). A row without a
 * meaning is a list entry still waiting for «اطلاعات کلمه‌ها». A column left out of the file keeps
 * what the words have; an empty cell empties it. The rows set the order of their words (`csvOrder`).
 * Every change goes to the change log. `dryRun` checks the file and reports without saving anything.
 */

export const CSV_MAX_CHARS = 3_000_000;
const required = ["code", "lemma", "pos", "level"] as const;
const editable = new Set(["draft", "needs_review"]);
const lowLevels = new Set(["A1", "A2"]);

export type CsvRowProblem = { row: number; label: string; problems: string[] };
export type CsvReport =
  | { state: "invalid"; reason: "empty" | "tooBig" | "columns"; missing?: string[] }
  | {
      state: "checked" | "imported";
      added: number;
      updated: number;
      unchanged: number;
      duplicates: number;
      rejected: CsvRowProblem[];
      ignored: string[];
      reordered: string[];
    };

type Column = (typeof wordCsvColumns)[number];
type Values = Partial<Record<Column, string>>;

const yes = new Set(["true", "1", "yes", "y", "بله", "آری", "x", "✓"]);
const no = new Set(["false", "0", "no", "n", "خیر", "نه", ""]);

/** A list entry without meaning (made by «فهرست کلمه‌ها», PRD §13.9) checks only what it has. */
const listEntry = wordRecord.extend({ meaning_fa: z.null(), concept_fa: optionalText });

type Existing = Awaited<ReturnType<typeof loadWords>>[number];

function loadWords(tx: Tx, language: string) {
  return tx.word.findMany({
    where: { language },
    select: {
      id: true,
      code: true,
      lemma: true,
      pos: true,
      gender: true,
      number: true,
      plural: true,
      meaning_fa: true,
      level: true,
      register: true,
      concept_id: true,
      no_card: true,
      homophones: true,
      note_fa: true,
      status: true,
      mastery: true,
      mastery_manual: true,
      frequency_rank: true,
      intro_order: true,
      sense_of: true,
      parts: true,
      concept: { select: { name_fa: true } },
    },
  });
}

/**
 * The new order of one level. The file's words that already had a place in the level take those
 * places, in file order; the rest of the level stays where it was. Each new word of the file goes
 * right after the file row before it, or before the next one when it opens the file, else at the end.
 * A whole level exported, reordered and imported again comes back exactly in file order.
 */
export function csvOrder(current: number[], file: number[]): number[] {
  const inFile = new Set(file);
  const slotted = file.filter((id) => current.includes(id));
  let next = 0;
  const order = current.map((id) => (inFile.has(id) ? slotted[next++] : id));
  const placed = new Set(order);
  for (const [index, id] of file.entries()) {
    if (placed.has(id)) continue;
    const before = file
      .slice(0, index)
      .reverse()
      .find((other) => placed.has(other));
    const after = before === undefined ? file.slice(index + 1).find((other) => placed.has(other)) : undefined;
    if (before !== undefined) order.splice(order.indexOf(before) + 1, 0, id);
    else if (after !== undefined) order.splice(order.indexOf(after), 0, id);
    else order.push(id);
    placed.add(id);
  }
  return order;
}

class DryRun extends Error {
  constructor(readonly report: CsvReport) {
    super("dry run");
  }
}

export async function importWordsCsv(input: { language: LanguageCode; text: string; adminId: number | null; dryRun: boolean }): Promise<CsvReport> {
  const { language, text, adminId, dryRun } = input;
  if (text.length > CSV_MAX_CHARS) return { state: "invalid", reason: "tooBig" };
  const table = parseCsv(text);
  if (table.length < 2) return { state: "invalid", reason: "empty" };
  const header = table[0].map((name) => name.trim().toLowerCase());
  const missing = required.filter((column) => !header.includes(column));
  if (missing.length > 0) return { state: "invalid", reason: "columns", missing };
  const present = new Set(header.filter((name): name is Column => (wordCsvColumns as readonly string[]).includes(name)));
  const ignored = [...new Set(header.filter((name) => name && !present.has(name as Column)))];
  const rows = table.slice(1).map((cells, index) => ({
    row: index + 2,
    values: Object.fromEntries(header.map((name, column) => [name, (cells[column] ?? "").trim()])) as Values,
  }));

  const [levels, produceRank] = await Promise.all([appSetting<string[]>(`levels.${language}`), engineNumber("mastery.produce_rank")]);

  const run = async (tx: Tx): Promise<CsvReport> => {
    const report = { added: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: [] as CsvRowProblem[], ignored, reordered: [] as string[] };
    const words = await loadWords(tx, language);
    const byCode = new Map(words.map((word) => [word.code, word]));
    const orderBefore = new Map<string, number[]>();
    for (const level of levels) {
      orderBefore.set(
        level,
        (await levelWords(tx, language, level)).rows.map((row) => row.id),
      );
    }
    const conceptIds = new Map((await tx.concept.findMany({ where: { language } })).map((concept) => [concept.name_fa, concept.id]));
    const reject = (row: number, label: string, problems: Problem[]) => report.rejected.push({ row, label, problems: problems.map((item) => describeProblem(item)) });

    // Pass 1: each row on its own, merged with the word it updates.
    type Parsed = { row: number; label: string; target: Existing | undefined; record: z.output<typeof wordRecord> | z.output<typeof listEntry> };
    const parsed: Parsed[] = [];
    const seen = new Set<string>();
    for (const { row, values } of rows) {
      const target = values.code ? byCode.get(values.code) : undefined;
      const label = values.lemma || values.code || "";
      const problems: Problem[] = [];
      const cell = (column: Column) => (present.has(column) ? values[column] || null : null);
      const keep = <T>(column: Column, existing: T) => (present.has(column) ? cell(column) : existing);

      let noCard = target?.no_card ?? false;
      if (present.has("no_card")) {
        const value = (values.no_card ?? "").toLowerCase();
        if (yes.has(value)) noCard = true;
        else if (no.has(value)) noCard = false;
        else problems.push(problem("badValue", { field: "no_card", value: values.no_card ?? "" }));
      }
      const record = {
        code: values.code ?? "",
        lemma: values.lemma ?? "",
        pos: values.pos ?? "",
        gender: keep("gender", target?.gender ?? null),
        number: keep("number", target?.number ?? null),
        plural: keep("plural", target?.plural ?? null),
        meaning_fa: keep("meaning_fa", target?.meaning_fa ?? null),
        level: values.level ?? "",
        register: keep("register", target?.register ?? null),
        concept_fa: keep("concept_fa", target?.concept?.name_fa ?? null),
        no_card: noCard,
        homophones: present.has("homophones") ? (values.homophones ?? "").split("|") : (target?.homophones ?? []),
        note_fa: keep("note_fa", target?.note_fa ?? null),
        mastery: null,
        sense_of: target?.sense_of ?? null,
        parts: target && target.parts.length > 0 ? target.parts : null,
      };

      if (target?.meaning_fa && !record.meaning_fa) problems.push(problem("csvMeaningCleared"));
      const result = record.meaning_fa ? wordRecord.safeParse(record, { reportInput: true }) : listEntry.safeParse(record, { reportInput: true });
      if (!result.success) problems.push(...zodProblems(result.error));
      else {
        const genders: readonly string[] = languageInfo[language].genders;
        if (result.data.meaning_fa) problems.push(...checkWord(result.data, language));
        else if (result.data.gender && !genders.includes(result.data.gender)) {
          problems.push(problem("genderForLanguage", { value: result.data.gender, allowed: genders.join("، "), field: "gender" }));
        }
        if (!levels.includes(result.data.level)) problems.push(problem("badValue", { field: "level", value: result.data.level }));
      }
      if (values.code && seen.has(values.code)) problems.push(problem("csvRepeated", { code: values.code }));
      if (values.code) seen.add(values.code);
      if (target && !editable.has(target.status)) problems.push(problem("locked", { code: target.code }));

      if (problems.length > 0 || !result.success) reject(row, label, problems);
      else parsed.push({ row, label, target, record: result.data });
    }

    // Pass 2: a colloquial word needs a standard word with the same concept (PRD §13.3).
    const conceptOf = new Map(words.filter((word) => word.concept).map((word) => [word.id, word.concept!.name_fa]));
    const standard = new Set(words.filter((word) => word.register === "standard" && word.concept_id).map((word) => conceptOf.get(word.id)));
    for (const item of parsed) if (item.record.meaning_fa && item.record.register === "standard") standard.add(item.record.concept_fa);
    const kept = parsed.filter((item) => {
      if (!item.record.meaning_fa || item.record.register === "standard" || standard.has(item.record.concept_fa)) return true;
      reject(item.row, item.label, [problem("colloquialWithoutStandard", { code: item.record.code, concept: item.record.concept_fa ?? "" })]);
      return false;
    });

    // Pass 3: write, in file order.
    const conceptId = async (name: string | null) => {
      if (!name) return null;
      let id = conceptIds.get(name);
      if (id === undefined) {
        id = (await tx.concept.create({ data: { language, name_fa: name } })).id;
        conceptIds.set(name, id);
      }
      return id;
    };
    const fileOrder = new Map<string, number[]>();
    const touched = new Set<string>();
    for (const item of kept) {
      const { record, target } = item;
      const rank = target?.frequency_rank ?? null;
      const mastery: Mastery = target?.mastery_manual
        ? target.mastery
        : lowLevels.has(record.level) || record.pos === "phrase"
          ? "produce"
          : rank !== null
            ? rank <= produceRank
              ? "produce"
              : "recognize"
            : (target?.mastery ?? "produce");
      const fields = {
        code: record.code,
        lemma: record.lemma,
        pos: record.pos,
        gender: record.gender,
        number: record.number,
        plural: record.plural,
        meaning_fa: record.meaning_fa,
        level: record.level,
        register: record.register,
        concept_id: record.meaning_fa ? await conceptId(record.concept_fa) : (target?.concept_id ?? null),
        no_card: record.no_card,
        homophones: record.homophones,
        note_fa: record.note_fa,
        mastery,
      };

      let id: number;
      if (target) {
        const before = Object.fromEntries(Object.keys(fields).map((key) => [key, target[key as keyof typeof target]]));
        const diff = changes(before, fields);
        id = target.id;
        if (diff) {
          const moved = target.level !== record.level;
          await tx.word.update({ where: { id }, data: { ...(diff.after as Prisma.WordUncheckedUpdateInput), ...(moved ? { intro_order: null } : {}) } });
          await logChange(tx, adminId, { action: "import", entity: "word", entityId: id, before: diff.before, after: diff.after });
          if (moved) touched.add(target.level);
          report.updated++;
        } else report.unchanged++;
      } else {
        const sameLemma = words.find((word) => fold(word.lemma) === fold(record.lemma));
        const isDuplicate = fold(record.code) === fold(record.lemma) && Boolean(sameLemma);
        const created = await tx.word.create({
          data: { ...fields, language, status: "draft", dup_of_id: isDuplicate ? sameLemma!.id : null },
          select: { id: true },
        });
        id = created.id;
        await logChange(tx, adminId, { action: "import", entity: "word", entityId: id, before: null, after: plain(fields) as Record<string, unknown> });
        report.added++;
        if (isDuplicate) report.duplicates++;
      }
      fileOrder.set(record.level, [...(fileOrder.get(record.level) ?? []), id]);
      touched.add(record.level);
    }

    // Pass 4: the order of each level the file touched.
    for (const level of [...touched].sort((a, b) => levelRank(a) - levelRank(b))) {
      const { rows: levelRows, anchored } = await levelWords(tx, language, level);
      const now = new Set(levelRows.map((row) => row.id));
      const before = orderBefore.get(level) ?? [];
      const current = before.filter((id) => now.has(id));
      const file = (fileOrder.get(level) ?? []).filter((id) => now.has(id));
      const merged = csvOrder(current, file);
      for (const row of levelRows) if (!merged.includes(row.id)) merged.push(row.id);
      const order = arrange(merged, anchored);
      await numberLevel(tx, levelRows, order);
      if (order.length !== before.length || order.some((id, index) => id !== before[index])) {
        await logChange(tx, adminId, { action: "order", entity: orderEntity.words, entityId: orderKey("words", language, level), before: { order: before }, after: { order } });
        report.reordered.push(level);
      }
    }

    const done: CsvReport = { state: dryRun ? "checked" : "imported", ...report };
    if (dryRun) throw new DryRun(done);
    return done;
  };

  try {
    return await db.$transaction(run, { timeout: 120_000, maxWait: 10_000 });
  } catch (error) {
    if (error instanceof DryRun) return error.report;
    throw error;
  }
}
