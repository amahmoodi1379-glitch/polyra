import type { Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { conjugationRecord, pronounKeys } from "@/schemas/conjugation";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { compareTable } from "../conjugation-check";
import { levelRank, type LanguageCode } from "../languages";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { batchSize, example, labelOf, languageValues, lines, trace } from "./shared";
import type { ContentKind } from "./types";

type Pair = { word_id: number; tense: string };
type ConjugationParams = { level: string; items: Pair[] };
export type TenseList = Record<string, string[]>;

const editable = new Set(["draft", "needs_review"]);
const openStates = ["prompt_made", "pasted"] as const;
const pairKey = (wordId: number, tense: string) => `${wordId}|${fold(tense)}`;

/** Verbs that get tables: card-ready verbs of the language (their meaning is in), auxiliaries included. */
const verbFilter = (language: string) =>
  ({ language, pos: "verb", meaning_fa: { not: null }, register: "standard", dup_of_id: null, status: { not: "retired" } }) as const;

/**
 * Every (verb, tense) that still has no table (PRD §6.6), in the order they are needed: the level of a
 * pair is the higher of the verb's and the tense's level, then the teaching order of the verb. Pairs in
 * an open P-X batch are left out, and so are tenses of a level whose grammar units do not exist yet
 * (a table names the unit that teaches it, PRD §13.3).
 */
export async function missingTables(language: string) {
  const [levels, tenses, verbs, tables, open, unitLevels] = await Promise.all([
    appSetting<string[]>(`levels.${language}`),
    appSetting<TenseList>(`conjugation.tenses.${language}`),
    db.word.findMany({ where: verbFilter(language), select: { id: true, code: true, lemma: true, level: true, intro_order: true } }),
    db.conjugationTable.findMany({ where: { language }, select: { word_id: true, tense: true } }),
    db.importBatch.findMany({ where: { language, prompt_kind: "P_X", state: { in: [...openStates] } }, select: { params: true } }),
    db.grammarUnit.groupBy({ by: ["level"], where: { language, status: { not: "retired" } } }),
  ]);
  const done = new Set(tables.map((row) => pairKey(row.word_id, row.tense)));
  for (const batch of open) {
    for (const pair of (batch.params as Partial<ConjugationParams> | null)?.items ?? []) done.add(pairKey(pair.word_id, pair.tense));
  }
  const withUnits = new Set(unitLevels.map((row) => row.level));
  const tenseList = levels.flatMap((level) => (tenses[level] ?? []).map((tense) => ({ tense, level })));
  const ordered = verbs
    .filter((verb) => levels.includes(verb.level))
    .sort((a, b) => (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9) || a.id - b.id);

  const pairs: { verb: (typeof ordered)[number]; tense: string; level: string }[] = [];
  let waitingForUnits = 0;
  for (const verb of ordered) {
    for (const { tense, level } of tenseList) {
      if (done.has(pairKey(verb.id, tense))) continue;
      if (!withUnits.has(level)) {
        waitingForUnits++;
        continue;
      }
      const top = levelRank(verb.level) >= levelRank(level) ? verb.level : level;
      pairs.push({ verb, tense, level: top });
    }
  }
  // Stable: within a level, verbs keep their teaching order and each verb its tenses in order.
  pairs.sort((a, b) => levelRank(a.level) - levelRank(b.level));
  return { pairs, waitingForUnits, hasVerbs: verbs.length > 0 };
}

/** The level with the first missing tables and how many tables it needs. */
export async function nextTables(language: string) {
  const { pairs, waitingForUnits, hasVerbs } = await missingTables(language);
  const level = pairs[0]?.level;
  return {
    next: level ? { level, count: pairs.filter((pair) => pair.level === level).length } : null,
    waitingForUnits: waitingForUnits > 0,
    hasVerbs,
  };
}

/**
 * P-X (PRD §14.6): conjugation tables, 20 at a time. The chatbot names the grammar unit that teaches
 * each table from the unit list; the table is then checked against the second source.
 */
export const conjugation: ContentKind = {
  kind: "P_X",
  template: "P-X.md",
  rootKey: "tables",

  async plan(language, options) {
    const { pairs } = await missingTables(language);
    const levels = new Set(pairs.map((pair) => pair.level));
    const level = (options.level && levels.has(options.level) ? options.level : null) ?? pairs[0]?.level;
    if (!level) return { nothing: t("admin.create.nothing.conjugation") };

    const size = await batchSize("P-X", 20);
    const batch = pairs.filter((pair) => pair.level === level).slice(0, size);
    const units = await db.grammarUnit.findMany({
      where: { language, status: { not: "retired" } },
      select: { unit_code: true, title_fa: true, level: true, order_no: true },
    });
    const unitLines = units
      .filter((unit) => levelRank(unit.level) <= levelRank(level))
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.order_no ?? 1e9) - (b.order_no ?? 1e9))
      .map((unit) => [unit.unit_code, unit.title_fa, unit.level].join(" | "));
    const verbs = [...new Set(batch.map((pair) => pair.verb.lemma))];

    return {
      params: { level, items: batch.map((pair) => ({ word_id: pair.verb.id, tense: pair.tense })) } satisfies ConjugationParams,
      values: {
        ...languageValues(language),
        items: batch.map((pair) => `${pair.verb.code} | ${pair.tense}`).join("\n"),
        units: lines(unitLines),
        keys: pronounKeys[language].join("، "),
        example: example("P-X", language),
      },
      summary: [
        t("admin.create.summary.conjugation", { count: batch.length, level }),
        verbs.slice(0, 8).join("، ") + (verbs.length > 8 ? "، …" : ""),
      ],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const language = batch.language as LanguageCode;
    const keys: readonly string[] = pronounKeys[language];
    const tenses = Object.values(await appSetting<TenseList>(`conjugation.tenses.${language}`)).flat();
    const tenseByFold = new Map(tenses.map((tense) => [fold(tense), tense]));
    const verbs = await tx.word.findMany({
      where: { language, status: { not: "retired" } },
      select: { id: true, code: true, lemma: true, pos: true },
    });
    const byCode = new Map(verbs.map((word) => [word.code, word]));
    const units = new Set((await tx.grammarUnit.findMany({ where: { language }, select: { unit_code: true } })).map((unit) => unit.unit_code));
    const seen = new Set<string>();

    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["verb"], index);
      const reject = (problems: Problem[]) => round.rejected.push({ label, record, problems });
      const parsed = conjugationRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        reject(zodProblems(parsed.error));
        continue;
      }
      const table = parsed.data;
      const problems: Problem[] = [];
      const word = byCode.get(table.verb);
      if (!word || word.pos !== "verb") problems.push(problem("verbUnknown", { code: table.verb }));
      const tense = tenseByFold.get(fold(table.tense));
      if (!tense) problems.push(problem("tenseUnknown", { value: table.tense, allowed: tenses.join("، ") }));
      const forms: Record<string, string> = {};
      const missing: string[] = [];
      for (const key of keys) {
        const value = table.forms[key]?.trim();
        if (value) forms[key] = value;
        else missing.push(key);
      }
      if (missing.length > 0) problems.push(problem("formsMissing", { keys: missing.join("، ") }));
      if (!table.unit_code) problems.push(problem("missing", { field: "unit_code" }));
      else if (!units.has(table.unit_code)) problems.push(problem("unitUnknown", { code: table.unit_code }));
      if (word && tense && seen.has(pairKey(word.id, tense))) {
        problems.push(problem("repeatedInAnswer", { code: `${table.verb} (${tense})` }));
      }
      if (problems.length > 0 || !word || !tense) {
        reject(problems);
        continue;
      }
      seen.add(pairKey(word.id, tense));

      const existing = await tx.conjugationTable.findUnique({ where: { word_id_tense: { word_id: word.id, tense } } });
      if (existing && !editable.has(existing.status)) {
        reject([problem("locked", { code: `${table.verb} (${tense})` })]);
        continue;
      }
      // Variants: only for the six persons, always a list.
      const variants: Record<string, string[]> = {};
      for (const key of keys) {
        const value = table.accepted_variants[key];
        const list = (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.trim()).filter(Boolean);
        if (list.length > 0) variants[key] = list;
      }
      const data = {
        unit_code: table.unit_code,
        forms: forms as Prisma.InputJsonValue,
        accepted_variants: variants as Prisma.InputJsonValue,
        review_card: table.review_card,
        ...trace(batch),
      };
      const saved = existing
        ? await tx.conjugationTable.update({ where: { id: existing.id }, data })
        : await tx.conjugationTable.create({ data: { language, word_id: word.id, tense, ...data } });
      if (existing) round.updated++;
      else round.added++;

      const name = `${table.verb} (${tense})`;
      const entity = { type: "conjugation_table" as const, id: saved.id };
      const second = compareTable(language, word.lemma, tense, forms, variants);
      if (second.result === "unknown") round.warnings.push({ label: name, problem: problem("secondSourceUnknown"), entity });
      if (second.result === "differs") {
        const persons = second.persons.map((person) => `${person.key}: ${person.given} ≠ ${person.expected}`).join("، ");
        round.warnings.push({ label: name, problem: problem("secondSourceDiffers", { persons }), entity });
      }
      round.accepted.push({ label: name, entity, record });
    }
    return round;
  },
};
