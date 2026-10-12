import { t } from "@/i18n";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { problem, type Problem } from "../problems";
import { emptyRound } from "../report";
import { loadVocabulary } from "../vocabulary";
import { grammarVocabulary, importTranslation, sameUnit, unitsInOrder, type GrammarContext } from "./grammar";
import { example, labelOf, languageValues, lines, params } from "./shared";
import type { ContentKind } from "./types";

type TranslationParams = { level: string; unit_id: number; unit_code: string };
type Counts = { translations: number };

/** A unit's own P-G work is settled once its batch has been through QA (or it never had one). */
const settled = new Set(["qa_done", "reviewed"]);

/**
 * Units with a lesson and fewer short translations than the goal (PRD §14.6 P-TR), in teaching order.
 * Each unit gets one P-TR batch: if the chatbot finds the unit unsuitable for translation it answers
 * with an empty list, and the unit is not asked for again.
 */
export async function translationUnits(language: string, level?: string) {
  const [levels, counts, units, batches, have] = await Promise.all([
    appSetting<string[]>(`levels.${language}`),
    appSetting<Counts>("prompt.grammar_counts"),
    unitsInOrder(language),
    db.importBatch.findMany({
      where: { language, prompt_kind: { in: ["P_G", "P_TR"] } },
      select: { prompt_kind: true, state: true, params: true },
    }),
    db.translateItem.groupBy({ by: ["grammar_unit_id"], where: { language, status: { not: "retired" } }, _count: true }),
  ]);
  const unitOf = (value: unknown) => (value as Partial<TranslationParams> | null)?.unit_id;
  const blocked = new Set(
    batches.filter((batch) => batch.prompt_kind === "P_TR" || !settled.has(batch.state)).map((batch) => unitOf(batch.params)),
  );
  const count = new Map(have.map((row) => [row.grammar_unit_id, row._count]));
  const want = counts.translations;

  const all = units.map((unit, index) => ({ unit, index, have: count.get(unit.id) ?? 0 }));
  const open = all.filter(
    ({ unit, have }) =>
      unit.lesson_fa && have < want && !blocked.has(unit.id) && levels.includes(unit.level) && (!level || unit.level === level),
  );
  return { open, all, want };
}

/** The next unit that needs short translations, and how many of its level are waiting. */
export async function nextTranslationUnit(language: string, level?: string) {
  const { open, all, want } = await translationUnits(language, level);
  const first = open[0];
  if (!first) return null;
  const waiting = open.filter((row) => row.unit.level === first.unit.level).length;
  return { ...first, want, waiting, before: all.slice(0, first.index).map((row) => row.unit) };
}

/**
 * P-TR (PRD §14.6): short translations for a unit that already has its lesson, made before short
 * translations existed or left short of them. Same rules and allowed words as the translations of P-G.
 */
export const translations: ContentKind = {
  kind: "P_TR",
  template: "P-TR.md",
  rootKey: "translations",
  matches: (batch, answer) => sameUnit(batch, answer.unit_code),

  async plan(language, options) {
    const next = await nextTranslationUnit(language, options.level);
    if (!next) return { nothing: t("admin.create.nothing.translations") };
    const { unit, index, before, have, want } = next;
    const lengths = await appSetting<Record<string, number>>("prompt.translation_length");
    const existing = await db.translateItem.findMany({
      where: { grammar_unit_id: unit.id, status: { not: "retired" } },
      orderBy: { id: "asc" },
      select: { prompt_fa: true },
    });
    const count = want - have;

    return {
      params: { level: unit.level, unit_id: unit.id, unit_code: unit.unit_code } satisfies TranslationParams,
      values: {
        ...languageValues(language),
        level: unit.level,
        code: unit.unit_code,
        title: unit.title_fa,
        scope: unit.scope_fa ?? unit.title_fa,
        previous: lines(before.map((row) => row.title_fa)),
        allowed: await grammarVocabulary(language, unit, index),
        count: String(count),
        existing: lines(existing.map((row) => row.prompt_fa)),
        length: String(lengths[unit.level] ?? 10),
        example: example("P-TR", language),
      },
      summary: [t("admin.create.summary.translations", { count, title: unit.title_fa, level: unit.level })],
      level: unit.level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const { unit_id } = params<TranslationParams>(batch);
    const unit = await tx.grammarUnit.findUnique({ where: { id: unit_id } });
    const vocabulary = await loadVocabulary(tx, batch.language);
    const seen = new Map<string, number>();

    for (const [index, record] of records.entries()) {
      const reject = (label: string, problems: Problem[]) => round.rejected.push({ label, record, problems });
      if (!unit) {
        reject(labelOf(record, ["prompt_fa"], index), [problem("unitGone")]);
        continue;
      }
      const context: GrammarContext = { tx, batch, unit, vocabulary, round, seen, reject };
      await importTranslation(context, record, index);
    }
    return round;
  },
};
