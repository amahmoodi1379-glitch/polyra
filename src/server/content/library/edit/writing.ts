import { z } from "zod";
import { filled, levelCode } from "@/schemas/common";
import { db } from "@/server/db";
import { checkWriting, writingRange } from "../../kinds/writing";
import { problem } from "../../problems";
import { errorsOf, logEdit, parseValues } from "./shared";
import { viewOf, type Editor } from "./types";

const phrase = z.object({ text: filled, translation_fa: filled });
const schema = z.object({
  prompt_fa: filled,
  level: levelCode,
  min_words: z.number().int().positive(),
  max_words: z.number().int().positive(),
  checklist_fa: z.array(filled),
  useful_phrases: z.array(phrase),
  model_answer: filled,
  model_answer_fa: filled,
});
export type WritingValues = z.output<typeof schema>;
export type WritingContext = { ranges: Record<string, [number, number]> };

/** A guided writing task (PRD §8b.6): every field, with the same rules as import. */
export const writingEditor: Editor<WritingValues, WritingContext> = {
  async load(id) {
    const row = await db.writingTask.findUnique({ where: { id } });
    if (!row) return null;
    const levels = ["B1", "B2"];
    const ranges = Object.fromEntries(await Promise.all(levels.map(async (level) => [level, await writingRange(level)] as const)));
    return {
      language: row.language,
      view: viewOf(row, row.prompt_fa, "fa", row.level),
      values: {
        prompt_fa: row.prompt_fa,
        level: row.level,
        min_words: row.min_words,
        max_words: row.max_words,
        checklist_fa: row.checklist_fa,
        useful_phrases: (row.useful_phrases ?? []) as WritingValues["useful_phrases"],
        model_answer: row.model_answer,
        model_answer_fa: row.model_answer_fa,
      },
      context: { ranges },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = parsed.values;
    const problems = checkWriting(values, await writingRange(values.level));
    return db.$transaction(async (tx) => {
      const row = await tx.writingTask.findUnique({ where: { id } });
      if (!row) return { state: "gone" as const };
      const twin = await tx.writingTask.findFirst({
        where: { language: row.language, level: values.level, prompt_fa: values.prompt_fa, id: { not: id }, status: { not: "retired" } },
        select: { id: true },
      });
      if (twin) problems.push(problem("sameItemExists", { field: "prompt_fa" }));
      if (problems.length > 0) return { state: "invalid" as const, errors: errorsOf(problems) };
      if (await logEdit(tx, adminId, "writing", id, row, values)) await tx.writingTask.update({ where: { id }, data: values });
      return { state: "saved" as const, values, notes: [] };
    });
  },
};
