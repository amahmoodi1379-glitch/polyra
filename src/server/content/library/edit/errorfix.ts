import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { filled, levelCode } from "@/schemas/common";
import { db } from "@/server/db";
import { checkMarks, correctedText, marksOf } from "../../kinds/errorfix";
import { tidy } from "../../kinds/sentence-store";
import { problem } from "../../problems";
import { loadVocabulary } from "../../vocabulary";
import { errorsOf, logEdit, parseValues, type WordInfo } from "./shared";
import { mapForEdit, tokenEdit, tokensForEdit, tokenWords, type TokenEdit } from "./tokens";
import { viewOf, type Editor } from "./types";
import type { UnitOption } from "./tables";

const schema = z.object({
  level: levelCode,
  marked_text: filled,
  translation_fa: filled,
  unit_codes: z.array(z.string()).transform((list) => [...new Set(list.map((code) => code.trim()).filter(Boolean))]),
  errors: z.array(z.object({ why_fa: z.string() })),
  tokens: z.array(tokenEdit),
});
export type ErrorfixValues = z.output<typeof schema>;
export type ErrorfixContext = { units: UnitOption[]; words: Record<string, WordInfo> };

const key = (text: string) => fold(tidy(text));

/**
 * A find-the-mistake text (PRD §8b.5): the marked text ({{غلط|درست}}), one explanation per mark,
 * its translation, units and the word mapping of the corrected text, with the same checks as import.
 */
export const errorfixEditor: Editor<ErrorfixValues, ErrorfixContext> = {
  async load(id) {
    const row = await db.errorfixItem.findUnique({ where: { id } });
    if (!row) return null;
    const [vocabulary, units] = await Promise.all([
      loadVocabulary(db, row.language),
      db.grammarUnit.findMany({
        where: { language: row.language, status: { not: "retired" } },
        orderBy: [{ level: "asc" }, { order_no: { sort: "asc", nulls: "last" } }],
        select: { unit_code: true, title_fa: true, level: true },
      }),
    ]);
    const tokens = tokensForEdit((row.tokens ?? []) as Parameters<typeof tokensForEdit>[0], vocabulary);
    return {
      language: row.language,
      view: viewOf(row, correctedText(row.marked_text), "target", row.level),
      values: {
        level: row.level,
        marked_text: row.marked_text,
        translation_fa: row.translation_fa,
        unit_codes: row.unit_codes,
        errors: ((row.errors ?? []) as { why_fa: string }[]).map((item) => ({ why_fa: item.why_fa })),
        tokens,
      },
      context: { units, words: await tokenWords(row.language, tokens) },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = { ...parsed.values, errors: parsed.values.errors.map((item) => ({ why_fa: item.why_fa.trim() })) };
    return db.$transaction(async (tx) => {
      const row = await tx.errorfixItem.findUnique({ where: { id } });
      if (!row) return { state: "gone" as const };
      const marks = marksOf(values.marked_text);
      const problems = checkMarks(marks, values.errors.length);
      values.errors.forEach((item, index) => {
        if (!item.why_fa) problems.push(problem("missing", { field: `errors[${index}].why_fa` }));
      });
      if (values.unit_codes.length === 0) problems.push(problem("missing", { field: "unit_codes" }));
      const known = new Set(
        (await tx.grammarUnit.findMany({ where: { language: row.language, unit_code: { in: values.unit_codes } }, select: { unit_code: true } })).map((unit) => unit.unit_code),
      );
      for (const code of values.unit_codes.filter((item) => !known.has(item))) problems.push(problem("unitUnknown", { code, field: "unit_codes" }));
      const text = correctedText(values.marked_text);
      const others = await tx.errorfixItem.findMany({ where: { language: row.language, id: { not: id }, status: { not: "retired" } }, select: { marked_text: true } });
      if (others.some((other) => key(correctedText(other.marked_text)) === key(text))) problems.push(problem("sameItemExists", { field: "marked_text" }));
      const vocabulary = await loadVocabulary(tx, row.language);
      const mapped = mapForEdit(text, values.tokens, vocabulary);
      const errors = [...errorsOf(problems), ...("errors" in mapped ? mapped.errors : [])];
      if (errors.length > 0 || !("rows" in mapped)) return { state: "invalid" as const, errors };

      const data = {
        level: values.level,
        marked_text: values.marked_text.trim(),
        translation_fa: values.translation_fa,
        unit_codes: values.unit_codes,
        errors: marks.map((mark, index) => ({ ...mark, why_fa: values.errors[index].why_fa })) as Prisma.InputJsonValue,
        tokens: mapped.rows as unknown as Prisma.InputJsonValue,
      };
      if (await logEdit(tx, adminId, "errorfix", id, row, data)) await tx.errorfixItem.update({ where: { id }, data });
      return { state: "saved" as const, values: { ...values, marked_text: data.marked_text, tokens: tokensForEdit(mapped.rows, vocabulary) as TokenEdit[] }, notes: [] };
    });
  },
};
