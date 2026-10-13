import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { filled } from "@/schemas/common";
import { db } from "@/server/db";
import { tidy } from "../../kinds/sentence-store";
import { problem, type Problem } from "../../problems";
import { loadVocabulary } from "../../vocabulary";
import { errorsOf, logEdit, parseValues, type WordInfo } from "./shared";
import { mapForEdit, tokenEdit, tokensForEdit, tokenWords, type TokenEdit } from "./tokens";
import { viewOf, type Editor } from "./types";

type UnitRef = { id: number; title_fa: string; unit_code: string; level: string };

const distinct = (values: string[]) => new Set(values.map((value) => fold(tidy(value)))).size === values.length;

const transformSchema = z.object({
  instruction_fa: filled,
  source_sentence: filled,
  accepted_outputs: z.array(filled).min(1),
});
export type TransformValues = z.output<typeof transformSchema>;

/** A sentence transformation of a grammar unit (PRD §6.4). */
export const transformEditor: Editor<TransformValues, { unit: UnitRef }> = {
  async load(id) {
    const row = await db.transformItem.findUnique({ where: { id }, include: { grammar_unit: true } });
    if (!row) return null;
    return {
      language: row.language,
      view: viewOf(row, row.source_sentence, "target", row.grammar_unit.level),
      values: { instruction_fa: row.instruction_fa, source_sentence: row.source_sentence, accepted_outputs: row.accepted_outputs },
      context: { unit: { id: row.grammar_unit.id, title_fa: row.grammar_unit.title_fa, unit_code: row.grammar_unit.unit_code, level: row.grammar_unit.level } },
    };
  },
  async save(id, raw, adminId) {
    const parsed = parseValues(transformSchema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = parsed.values;
    if (!distinct(values.accepted_outputs)) return { state: "invalid", errors: errorsOf([problem("listRepeat", { field: "accepted_outputs" })]) };
    return db.$transaction(async (tx) => {
      const row = await tx.transformItem.findUnique({ where: { id } });
      if (!row) return { state: "gone" as const };
      if (await logEdit(tx, adminId, "transforms", id, row, values)) await tx.transformItem.update({ where: { id }, data: values });
      return { state: "saved" as const, values, notes: [] };
    });
  },
};

const translationSchema = z.object({
  prompt_fa: filled,
  accepted_outputs: z.array(filled).min(1),
  tokens: z.array(tokenEdit),
});
export type TranslationValues = z.output<typeof translationSchema>;
export type TranslationContext = { unit: UnitRef; words: Record<string, WordInfo> };

/** A short translation (PRD §8b.3): its Persian sentence, accepted answers and the first answer's words. */
export const translationEditor: Editor<TranslationValues, TranslationContext> = {
  async load(id) {
    const row = await db.translateItem.findUnique({ where: { id }, include: { grammar_unit: true } });
    if (!row) return null;
    const vocabulary = await loadVocabulary(db, row.language);
    const tokens = tokensForEdit((row.tokens ?? []) as Parameters<typeof tokensForEdit>[0], vocabulary);
    return {
      language: row.language,
      view: viewOf(row, row.prompt_fa, "fa", row.grammar_unit.level),
      values: { prompt_fa: row.prompt_fa, accepted_outputs: row.accepted_outputs, tokens },
      context: {
        unit: { id: row.grammar_unit.id, title_fa: row.grammar_unit.title_fa, unit_code: row.grammar_unit.unit_code, level: row.grammar_unit.level },
        words: await tokenWords(row.language, tokens),
      },
    };
  },
  async save(id, raw, adminId) {
    const parsed = parseValues(translationSchema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = parsed.values;
    return db.$transaction(async (tx) => {
      const row = await tx.translateItem.findUnique({ where: { id } });
      if (!row) return { state: "gone" as const };
      const problems: Problem[] = [];
      if (!distinct(values.accepted_outputs)) problems.push(problem("listRepeat", { field: "accepted_outputs" }));
      const twin = await tx.translateItem.findFirst({
        where: { grammar_unit_id: row.grammar_unit_id, prompt_fa: values.prompt_fa, id: { not: id }, status: { not: "retired" } },
        select: { id: true },
      });
      if (twin) problems.push(problem("sameItemExists", { field: "prompt_fa" }));
      const vocabulary = await loadVocabulary(tx, row.language);
      const mapped = mapForEdit(values.accepted_outputs[0], values.tokens, vocabulary);
      const errors = [...errorsOf(problems), ...("errors" in mapped ? mapped.errors : [])];
      if (errors.length > 0 || !("rows" in mapped)) return { state: "invalid" as const, errors };
      const tokens = tokensForEdit(mapped.rows, vocabulary);
      const data = { prompt_fa: values.prompt_fa, accepted_outputs: values.accepted_outputs, tokens: mapped.rows as unknown as Prisma.InputJsonValue };
      if (await logEdit(tx, adminId, "translations", id, row, data)) await tx.translateItem.update({ where: { id }, data });
      return { state: "saved" as const, values: { ...values, tokens: tokens as TokenEdit[] }, notes: [] };
    });
  },
};
