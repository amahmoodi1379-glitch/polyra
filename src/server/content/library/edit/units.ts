import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { filled, levelCode, optionalText } from "@/schemas/common";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";
import type { Tx } from "../../kinds/types";
import { problem, type Problem } from "../../problems";
import { levelOutside } from "../../kinds/shared";
import { errorsOf, logEdit, parseValues } from "./shared";
import { viewOf, type Editor } from "./types";

const schema = z.object({
  title_fa: filled,
  level: levelCode,
  scope_fa: optionalText,
  can_do_fa: optionalText,
  lesson_fa: optionalText,
  rule_line_fa: optionalText,
  common_mistake_fa: optionalText,
  build_table: z.array(z.array(z.string())).nullable(),
  category_sets: z.array(z.object({ name: z.string(), items: z.array(z.string()) })).nullable(),
  example_sentence_ids: z.array(z.number().int()).transform((ids) => [...new Set(ids)]),
});
export type UnitValues = z.output<typeof schema>;
export type SentenceLine = { id: number; text: string; translation_fa: string };
export type UnitContext = {
  unitCode: string;
  /** The examples and the unit's own practice sentences, which are what can be added (PRD §6). */
  sentences: SentenceLine[];
  practice: number[];
  counts: { targets: number; minTargets: number; transforms: number; translations: number; tables: number };
};

/** PRD §6: 3 to 4 examples; a unit is published with at least 3 (PRD §6.7). */
const EXAMPLES = { min: 3, max: 4 };

/** Sentences of the unit's live practice targets, in the order they came in. */
async function practiceSentences(tx: Tx | typeof db, unitId: number) {
  const rows = await tx.sentenceTarget.findMany({
    where: { target_type: "grammar", target_id: unitId, status: { not: "retired" }, sentence: { status: { not: "retired" } } },
    select: { sentence_id: true },
    distinct: ["sentence_id"],
    orderBy: { sentence_id: "asc" },
  });
  return rows.map((row) => row.sentence_id);
}

/**
 * A grammar unit (PRD §6): titles, lesson, one-line rule, common mistake, the build table, the
 * category sets and its examples. A unit still waiting for its lesson (made from the unit list) can be
 * renamed alone; once it has a lesson, rule and common mistake are needed too (PRD §13.3). Examples
 * can be put in order, taken out, or added from the unit's own practice sentences; a sentence taken
 * out stays in the sentence bank, so «برگردان» can put it back.
 */
export const unitEditor: Editor<UnitValues, UnitContext> = {
  async load(id) {
    const row = await db.grammarUnit.findUnique({ where: { id } });
    if (!row) return null;
    const practice = await practiceSentences(db, id);
    const [sentences, targets, minTargets, transforms, translations, tables] = await Promise.all([
      db.sentence.findMany({ where: { id: { in: [...row.example_sentence_ids, ...practice] } }, select: { id: true, text: true, translation_fa: true } }),
      db.sentenceTarget.count({ where: { target_type: "grammar", target_id: id, status: { not: "retired" } } }),
      engineNumber("publish.unit_min_targets"),
      db.transformItem.count({ where: { grammar_unit_id: id, status: { not: "retired" } } }),
      db.translateItem.count({ where: { grammar_unit_id: id, status: { not: "retired" } } }),
      db.conjugationTable.count({ where: { unit_code: row.unit_code, status: { not: "retired" } } }),
    ]);
    return {
      language: row.language,
      view: viewOf(row, row.title_fa, "fa", row.level),
      values: {
        title_fa: row.title_fa,
        level: row.level,
        scope_fa: row.scope_fa,
        can_do_fa: row.can_do_fa,
        lesson_fa: row.lesson_fa,
        rule_line_fa: row.rule_line_fa,
        common_mistake_fa: row.common_mistake_fa,
        build_table: (row.build_table ?? null) as string[][] | null,
        category_sets: (row.category_sets ?? null) as UnitValues["category_sets"],
        example_sentence_ids: row.example_sentence_ids,
      },
      context: {
        unitCode: row.unit_code,
        sentences,
        practice,
        counts: { targets, minTargets, transforms, translations, tables },
      },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = parsed.values;
    const problems: Problem[] = [];
    const lessonParts = [values.lesson_fa, values.rule_line_fa, values.common_mistake_fa];
    if (lessonParts.some(Boolean)) {
      for (const [field, value] of [["lesson_fa", values.lesson_fa], ["rule_line_fa", values.rule_line_fa], ["common_mistake_fa", values.common_mistake_fa]] as const) {
        if (!value) problems.push(problem("missing", { field }));
      }
    }
    // Empty cells and empty rows are dropped; a table with nothing left is no table.
    const table = values.build_table?.map((cells) => cells.map((cell) => cell.trim())).filter((cells) => cells.some(Boolean)) ?? [];
    const sets = (values.category_sets ?? [])
      .map((set) => ({ name: set.name.trim(), items: set.items.map((item) => item.trim()).filter(Boolean) }))
      .filter((set) => set.name || set.items.length > 0);
    sets.forEach((set, index) => {
      if (!set.name) problems.push(problem("missing", { field: `category_sets[${index}].name` }));
      if (set.items.length === 0) problems.push(problem("missing", { field: `category_sets[${index}].items` }));
    });
    if (problems.length > 0) return { state: "invalid", errors: errorsOf(problems) };

    const clean = { ...values, build_table: table.length > 0 ? table : null, category_sets: sets.length > 0 ? sets : null };
    return db.$transaction(async (tx) => {
      const row = await tx.grammarUnit.findUnique({ where: { id } });
      if (!row) return { state: "gone" as const };
      const late: Problem[] = await levelOutside(row.language, clean.level);
      const allowed = new Set([...row.example_sentence_ids, ...(await practiceSentences(tx, id))]);
      if (clean.example_sentence_ids.some((sentenceId) => !allowed.has(sentenceId))) late.push(problem("exampleNotPractice", { field: "example_sentence_ids" }));
      // A hand change does not take the examples further from 3 to 4; an approved or published unit
      // does not drop below the examples it is published with.
      const count = clean.example_sentence_ids.length;
      const before = row.example_sentence_ids.length;
      if (count > EXAMPLES.max && count > before) late.push(problem("tooMany", { field: "example_sentence_ids", max: EXAMPLES.max }));
      const live = row.status === "approved" || row.status === "published";
      if (live && count < EXAMPLES.min && count < before) late.push(problem("tooFew", { field: "example_sentence_ids", min: EXAMPLES.min }));
      if (late.length > 0) return { state: "invalid" as const, errors: errorsOf(late) };
      if (await logEdit(tx, adminId, "units", id, row, clean)) {
        await tx.grammarUnit.update({
          where: { id },
          data: {
            ...clean,
            build_table: clean.build_table ?? Prisma.DbNull,
            category_sets: clean.category_sets ?? Prisma.DbNull,
          },
        });
      }
      return { state: "saved" as const, values: clean, notes: [] };
    });
  },
};
