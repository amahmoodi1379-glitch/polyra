import type { Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { grammarTarget, transformRecord, translationRecord, unitRecord } from "@/schemas/grammar";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { levelRank } from "../languages";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound, type RoundResult } from "../report";
import { loadVocabulary, type LoadedVocabulary } from "../vocabulary";
import { addTargets, checkTarget, lengthFlags, mapSentence, storeSentence, tidy, type SentenceInput } from "./sentence-store";
import { example, labelOf, languageValues, lines, params, trace } from "./shared";
import type { ContentKind, Tx } from "./types";

type GrammarParams = { level: string; unit_id: number; unit_code: string };
type Counts = { targets: number; transforms: number; translations: number };

/** The first units of a language use only the first words (PRD §14.9). */
const FIRST_UNITS = 20;
const FIRST_WORDS = 150;
/** Above this many allowed words the meanings are left out so the prompt fits (PRD §14.9). */
const LIST_WITH_MEANINGS = 600;

const editable = new Set(["draft", "needs_review"]);
const openStates = ["prompt_made", "pasted"] as const;

type UnitRow = { id: number; unit_code: string; title_fa: string; scope_fa: string | null; level: string; order_no: number | null };

/** Units in teaching order: level first, then the order of the unit list. */
async function unitsInOrder(language: string) {
  const units = await db.grammarUnit.findMany({
    where: { language, status: { not: "retired" } },
    select: { id: true, unit_code: true, title_fa: true, scope_fa: true, level: true, order_no: true, lesson_fa: true },
  });
  return units.sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.order_no ?? 1e9) - (b.order_no ?? 1e9) || a.id - b.id);
}

/** Units somebody already started a P-G batch for; the next batch skips them. */
async function unitsInProgress(language: string) {
  const open = await db.importBatch.findMany({ where: { language, prompt_kind: "P_G", state: { in: [...openStates] } }, select: { params: true } });
  return new Set(open.map((batch) => (batch.params as Partial<GrammarParams> | null)?.unit_id).filter((id): id is number => typeof id === "number"));
}

/**
 * The words a grammar unit may use (PRD §14.9): for the first 20 units of a language the first 150
 * words of the teaching order plus the no_card words; after that every word of the unit's level and
 * below. Also used for short translations (P-TR).
 */
export async function grammarVocabulary(language: string, unit: Pick<UnitRow, "level">, index: number) {
  const words = await db.word.findMany({
    where: { language, status: { not: "retired" }, dup_of_id: null },
    select: { code: true, pos: true, meaning_fa: true, level: true, intro_order: true, no_card: true, register: true },
  });
  const ordered = words
    .filter((word) => !word.no_card && word.register === "standard")
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9));
  const allowed =
    index < FIRST_UNITS
      ? [...ordered.slice(0, FIRST_WORDS), ...words.filter((word) => word.no_card)]
      : words.filter((word) => levelRank(word.level) <= levelRank(unit.level));
  const withMeaning = allowed.length <= LIST_WITH_MEANINGS;
  return lines(allowed.map((word) => [word.code, word.pos, ...(withMeaning ? [word.meaning_fa ?? "—"] : [])].join(" | ")));
}

/** The next grammar unit that has no lesson yet, in teaching order. */
export async function nextUnit(language: string, level?: string) {
  const levels = await appSetting<string[]>(`levels.${language}`);
  const units = await unitsInOrder(language);
  const busy = await unitsInProgress(language);
  const index = units.findIndex(
    (unit) => !unit.lesson_fa && !busy.has(unit.id) && levels.includes(unit.level) && (!level || unit.level === level),
  );
  if (index < 0) return null;
  const unit = units[index];
  const waiting = units.filter((row) => !row.lesson_fa && !busy.has(row.id) && row.level === unit.level).length;
  return { unit, index, before: units.slice(0, index), waiting };
}

/**
 * P-G (PRD §14.6): one whole grammar unit. The unit row comes from the unit list (P-U); this fills
 * its lesson and adds its targets, transforms and short translations. A second answer for the same
 * unit (the chatbot sends 20 targets at a time) only adds what is new.
 */
export const grammar: ContentKind = {
  kind: "P_G",
  template: "P-G.md",
  rootKey: "unit",
  parts: [{ key: "unit", single: true }, { key: "targets" }, { key: "transforms" }, { key: "translations" }],

  async plan(language, options) {
    const next = await nextUnit(language, options.level);
    if (!next) return { nothing: t("admin.create.nothing.grammar") };
    const { unit, index, before } = next;
    const counts = await appSetting<Counts>("prompt.grammar_counts");
    const lengths = await appSetting<Record<string, number>>("prompt.translation_length");

    return {
      params: { level: unit.level, unit_id: unit.id, unit_code: unit.unit_code } satisfies GrammarParams,
      values: {
        ...languageValues(language),
        level: unit.level,
        code: unit.unit_code,
        title: unit.title_fa,
        scope: unit.scope_fa ?? unit.title_fa,
        previous: lines(before.map((row) => row.title_fa)),
        allowed: await grammarVocabulary(language, unit, index),
        targets: String(counts.targets),
        transforms: String(counts.transforms),
        translations: String(counts.translations),
        length: String(lengths[unit.level] ?? 10),
        example: example("P-G", language),
      },
      summary: [t("admin.create.summary.grammar", { title: unit.title_fa, level: unit.level })],
      level: unit.level,
    };
  },

  async importRecords(tx, batch, records, parts) {
    const round = emptyRound();
    const { unit_id, unit_code } = params<GrammarParams>(batch);
    const unit = await tx.grammarUnit.findUnique({ where: { id: unit_id } });
    const vocabulary = await loadVocabulary(tx, batch.language);
    const seen = new Map<string, number>();

    for (const [index, record] of records.entries()) {
      const part = parts[index] ?? "targets";
      const reject = (label: string, problems: Problem[]) => round.rejected.push({ label, record, problems, part });
      if (!unit) {
        reject(labelOf(record, ["title_fa", "source", "prompt_fa"], index), [problem("unitGone")]);
        continue;
      }
      const context: Context = { tx, batch, unit, vocabulary, round, seen, reject };
      if (part === "unit") await importUnit(context, record, unit_code);
      else if (part === "transforms") await importTransform(context, record, index);
      else if (part === "translations") await importTranslation(context, record, index);
      else await importTarget(context, record, index);
    }
    return round;
  },
};

type Context = {
  tx: Tx;
  batch: Parameters<ContentKind["importRecords"]>[1];
  unit: { id: number; unit_code: string; level: string; status: string };
  vocabulary: LoadedVocabulary;
  round: RoundResult;
  seen: Map<string, number>;
  reject: (label: string, problems: Problem[]) => void;
};

/** Checks the word mapping of every sentence first, so nothing is stored for a rejected record. */
function mapAll(sentences: SentenceInput[], vocabulary: LoadedVocabulary) {
  const problems: Problem[] = [];
  const rows = sentences.map((sentence) => {
    const mapped = mapSentence(sentence, vocabulary);
    problems.push(...mapped.problems);
    return mapped.rows;
  });
  return { rows, problems };
}

async function importUnit({ tx, batch, unit, vocabulary, round, seen, reject }: Context, record: unknown, expected: string) {
  const label = labelOf(record, ["title_fa", "unit_code"], 0);
  const parsed = unitRecord.safeParse(record, { reportInput: true });
  if (!parsed.success) return reject(label, zodProblems(parsed.error, "unit"));
  const data = parsed.data;
  const problems: Problem[] = [];
  if (data.unit_code !== expected) problems.push(problem("unitCodeMismatch", { value: data.unit_code, expected }));
  if (data.level !== unit.level) problems.push(problem("levelMismatch", { value: data.level, level: unit.level }));
  if (!editable.has(unit.status)) problems.push(problem("locked", { code: unit.unit_code }));
  const mapped = mapAll(data.example_sentences, vocabulary);
  problems.push(...mapped.problems);
  if (problems.length > 0) return reject(label, problems);

  const exampleIds: number[] = [];
  for (const [k, sentence] of data.example_sentences.entries()) {
    const stored = await storeSentence(tx, batch, { sentence, rows: mapped.rows[k]!, vocabulary, level: unit.level, label }, round, seen);
    exampleIds.push(stored.id);
  }
  await tx.grammarUnit.update({
    where: { id: unit.id },
    data: {
      lesson_fa: data.lesson_fa,
      build_table: (data.build_table ?? undefined) as Prisma.InputJsonValue | undefined,
      example_sentence_ids: exampleIds,
      rule_line_fa: data.rule_line_fa,
      common_mistake_fa: data.common_mistake_fa,
      category_sets: (data.category_sets ?? undefined) as Prisma.InputJsonValue | undefined,
      ...(data.can_do_fa ? { can_do_fa: data.can_do_fa } : {}),
      ...trace(batch),
    },
  });
  round.updated++;
  round.accepted.push({ label: data.title_fa, entity: { type: "grammar_unit", id: unit.id }, record, part: "unit" });
}

async function importTarget({ tx, batch, unit, vocabulary, round, seen, reject }: Context, record: unknown, index: number) {
  const label = labelOf((record as { sentence?: unknown } | null)?.sentence, ["text"], index);
  const parsed = grammarTarget.safeParse(record, { reportInput: true });
  if (!parsed.success) return reject(label, zodProblems(parsed.error));
  const target = parsed.data;
  const mapped = mapSentence(target.sentence, vocabulary);
  const problems = [...mapped.problems, ...checkTarget(target, target.sentence.text, "")];
  if (problems.length > 0 || !mapped.rows) return reject(label, problems);
  round.warnings.push(...lengthFlags(target.sentence.text, [target], label));

  const stored = await storeSentence(tx, batch, { sentence: target.sentence, rows: mapped.rows, vocabulary, level: unit.level, label }, round, seen);
  const added = await addTargets(tx, batch, stored.id, [{ type: "grammar", id: unit.id, target }]);
  if (added > 0) round.added++;
  else round.skipped++;
  round.accepted.push({ label: target.sentence.text, entity: { type: "sentence", id: stored.id }, record, part: "targets" });
}

const distinct = (values: string[]) => new Set(values.map((value) => fold(tidy(value)))).size === values.length;

async function importTransform({ tx, batch, unit, round, reject }: Context, record: unknown, index: number) {
  const label = labelOf(record, ["source", "instruction_fa"], index);
  const parsed = transformRecord.safeParse(record, { reportInput: true });
  if (!parsed.success) return reject(label, zodProblems(parsed.error));
  const item = parsed.data;
  if (!distinct(item.accepted_outputs)) return reject(label, [problem("listRepeat", { field: "accepted_outputs" })]);

  const same = await tx.transformItem.findFirst({
    where: { grammar_unit_id: unit.id, source_sentence: item.source, instruction_fa: item.instruction_fa },
    select: { id: true },
  });
  if (same) {
    round.skipped++;
    round.accepted.push({ label, entity: { type: "transform_item", id: same.id }, record, part: "transforms" });
    return;
  }
  const created = await tx.transformItem.create({
    data: {
      language: batch.language,
      grammar_unit_id: unit.id,
      instruction_fa: item.instruction_fa,
      source_sentence: item.source,
      accepted_outputs: item.accepted_outputs,
      ...trace(batch),
    },
  });
  round.added++;
  round.accepted.push({ label, entity: { type: "transform_item", id: created.id }, record, part: "transforms" });
}

/** A short translation (PRD §8b.3); also imported on its own by P-TR. */
export async function importTranslation({ tx, batch, unit, vocabulary, round, reject }: Context, record: unknown, index: number) {
  const label = labelOf(record, ["prompt_fa"], index);
  const parsed = translationRecord.safeParse(record, { reportInput: true });
  if (!parsed.success) return reject(label, zodProblems(parsed.error));
  const item = parsed.data;
  const problems: Problem[] = [];
  if (!distinct(item.accepted_outputs)) problems.push(problem("listRepeat", { field: "accepted_outputs" }));
  const mapped = mapSentence({ text: item.accepted_outputs[0], tokens: item.tokens }, vocabulary);
  problems.push(...mapped.problems);
  if (problems.length > 0 || !mapped.rows) return reject(label, problems);

  // One short translation per Persian sentence in a unit (PRD §14.9).
  const same = await tx.translateItem.findFirst({ where: { grammar_unit_id: unit.id, prompt_fa: item.prompt_fa }, select: { id: true } });
  if (same) {
    round.skipped++;
    round.accepted.push({ label, entity: { type: "translate_item", id: same.id }, record, part: "translations" });
    return;
  }
  const unknown = mapped.rows.filter((row) => row.kind === "word" && (!row.word_id || row.candidate_reason)).length;
  if (unknown > 0) round.warnings.push({ label, problem: problem("unknownWords", { count: unknown }) });
  const created = await tx.translateItem.create({
    data: {
      language: batch.language,
      grammar_unit_id: unit.id,
      prompt_fa: item.prompt_fa,
      accepted_outputs: item.accepted_outputs,
      tokens: mapped.rows as unknown as Prisma.InputJsonValue,
      ...trace(batch),
    },
  });
  round.added++;
  round.accepted.push({ label, entity: { type: "translate_item", id: created.id }, record, part: "translations" });
}

export type { Context as GrammarContext };
