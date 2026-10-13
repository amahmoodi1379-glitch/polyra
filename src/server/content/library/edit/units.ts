import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { filled, levelCode, optionalText } from "@/schemas/common";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";
import { problem, type Problem } from "../../problems";
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
});
export type UnitValues = z.output<typeof schema>;
export type SentenceLine = { id: number; text: string; translation_fa: string };
export type UnitContext = {
  unitCode: string;
  examples: SentenceLine[];
  counts: { targets: number; minTargets: number; transforms: number; translations: number; tables: number };
};

/**
 * A grammar unit (PRD §6): titles, lesson, one-line rule, common mistake, the build table and the
 * category sets. A unit still waiting for its lesson (made from the unit list) can be renamed alone;
 * once it has a lesson, rule and common mistake are needed too (PRD §13.3).
 */
export const unitEditor: Editor<UnitValues, UnitContext> = {
  async load(id) {
    const row = await db.grammarUnit.findUnique({ where: { id } });
    if (!row) return null;
    const [examples, targets, minTargets, transforms, translations, tables] = await Promise.all([
      db.sentence.findMany({ where: { id: { in: row.example_sentence_ids } }, select: { id: true, text: true, translation_fa: true } }),
      db.sentenceTarget.count({ where: { target_type: "grammar", target_id: id, status: { not: "retired" } } }),
      engineNumber("publish.unit_min_targets"),
      db.transformItem.count({ where: { grammar_unit_id: id, status: { not: "retired" } } }),
      db.translateItem.count({ where: { grammar_unit_id: id, status: { not: "retired" } } }),
      db.conjugationTable.count({ where: { unit_code: row.unit_code, status: { not: "retired" } } }),
    ]);
    const order = new Map(row.example_sentence_ids.map((sentenceId, index) => [sentenceId, index]));
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
      },
      context: {
        unitCode: row.unit_code,
        examples: examples.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
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
