import { z } from "zod";
import { pronounKeys } from "@/schemas/conjugation";
import { db } from "@/server/db";
import { compareTable } from "../../conjugation-check";
import type { LanguageCode } from "../../languages";
import { describeProblem, problem, type Problem } from "../../problems";
import { errorsOf, logEdit, parseValues } from "./shared";
import { viewOf, type Editor } from "./types";

const schema = z.object({
  forms: z.record(z.string(), z.string()),
  accepted_variants: z.record(z.string(), z.array(z.string())),
  review_card: z.boolean(),
  unit_code: z.string().nullable(),
});
export type TableValues = z.output<typeof schema>;
export type UnitOption = { unit_code: string; title_fa: string; level: string };
export type TableContext = { verb: string; tense: string; keys: string[]; units: UnitOption[] };

/**
 * A conjugation table (PRD §6.6): six forms, accepted variants, the review-card switch and its unit.
 * Saving compares it with the second source again (PRD §16.2) and says so when they differ.
 */
export const tableEditor: Editor<TableValues, TableContext> = {
  async load(id) {
    const row = await db.conjugationTable.findUnique({ where: { id }, include: { word: true } });
    if (!row) return null;
    const keys = [...pronounKeys[row.language as LanguageCode]];
    const units = await db.grammarUnit.findMany({
      where: { language: row.language, status: { not: "retired" } },
      orderBy: [{ level: "asc" }, { order_no: { sort: "asc", nulls: "last" } }],
      select: { unit_code: true, title_fa: true, level: true },
    });
    const forms = (row.forms ?? {}) as Record<string, string>;
    const variants = (row.accepted_variants ?? {}) as Record<string, string[]>;
    return {
      language: row.language,
      view: viewOf(row, `${row.word.lemma} · ${row.tense}`, "target", row.word.level),
      values: {
        forms: Object.fromEntries(keys.map((key) => [key, forms[key] ?? ""])),
        accepted_variants: Object.fromEntries(keys.map((key) => [key, variants[key] ?? []])),
        review_card: row.review_card,
        unit_code: row.unit_code,
      },
      context: { verb: row.word.lemma, tense: row.tense, keys, units },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    return db.$transaction(async (tx) => {
      const row = await tx.conjugationTable.findUnique({ where: { id }, include: { word: true } });
      if (!row) return { state: "gone" as const };
      const language = row.language as LanguageCode;
      const keys = pronounKeys[language];
      const problems: Problem[] = [];
      const forms: Record<string, string> = {};
      const variants: Record<string, string[]> = {};
      for (const key of keys) {
        const form = parsed.values.forms[key]?.trim() ?? "";
        if (!form) problems.push(problem("missing", { field: `forms.${key}` }));
        forms[key] = form;
        const list = (parsed.values.accepted_variants[key] ?? []).map((item) => item.trim()).filter(Boolean);
        if (list.length > 0) variants[key] = list;
      }
      const unitCode = parsed.values.unit_code?.trim() || null;
      if (!unitCode) problems.push(problem("missing", { field: "unit_code" }));
      else if (!(await tx.grammarUnit.findUnique({ where: { unit_code: unitCode }, select: { id: true } }))) {
        problems.push(problem("unitUnknown", { code: unitCode, field: "unit_code" }));
      }
      if (problems.length > 0) return { state: "invalid" as const, errors: errorsOf(problems) };

      const data = { forms, accepted_variants: variants, review_card: parsed.values.review_card, unit_code: unitCode };
      if (await logEdit(tx, adminId, "tables", id, row, data)) await tx.conjugationTable.update({ where: { id }, data });

      const second = compareTable(language, row.word.lemma, row.tense, forms, variants);
      const notes =
        second.result === "differs"
          ? [describeProblem(problem("secondSourceDiffers", { persons: second.persons.map((person) => `${person.key}: ${person.given} ≠ ${person.expected}`).join("، ") }))]
          : second.result === "unknown"
            ? [describeProblem(problem("secondSourceUnknown"))]
            : [];
      return {
        state: "saved" as const,
        values: { ...data, forms, accepted_variants: Object.fromEntries(keys.map((key) => [key, variants[key] ?? []])) },
        notes,
      };
    });
  },
};
