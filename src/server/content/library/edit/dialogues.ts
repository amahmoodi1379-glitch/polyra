import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { filled, levelCode } from "@/schemas/common";
import { db } from "@/server/db";
import { problem, type Problem } from "../../problems";
import { turnSentenceIds } from "../list";
import { errorsOf, logEdit, parseValues } from "./shared";
import { viewOf, type Editor } from "./types";

type StoredTurn = { sentence_id: number; speaker: string | null; choices: { sentence_id: number }[]; correct: number; why_fa: string };

const schema = z.object({
  title_fa: filled,
  situation_fa: filled,
  level: levelCode,
  turns: z.array(z.object({ speaker: z.string().nullable(), correct: z.number().int(), why_fa: z.string() })),
});
export type DialogueValues = z.output<typeof schema>;
export type DialogueSentence = { id: number; text: string; translation_fa: string; status: string };
export type DialogueContext = { code: string; turns: { line: DialogueSentence | null; choices: (DialogueSentence | null)[] }[] };

/**
 * A situational dialogue (PRD §8b.4): title, situation, and per turn the speaker, the right choice and
 * why. Lines and choices are sentences, edited on their own page so their audio and words stay right.
 */
export const dialogueEditor: Editor<DialogueValues, DialogueContext> = {
  async load(id) {
    const row = await db.dialogue.findUnique({ where: { id } });
    if (!row) return null;
    const turns = (row.turns ?? []) as StoredTurn[];
    const sentences = await db.sentence.findMany({
      where: { id: { in: turnSentenceIds(turns) } },
      select: { id: true, text: true, translation_fa: true, status: true },
    });
    const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]));
    return {
      language: row.language,
      view: viewOf(row, row.title_fa, "fa", row.level),
      values: {
        title_fa: row.title_fa,
        situation_fa: row.situation_fa,
        level: row.level,
        turns: turns.map((turn) => ({ speaker: turn.speaker, correct: turn.correct, why_fa: turn.why_fa })),
      },
      context: {
        code: row.code,
        turns: turns.map((turn) => ({
          line: byId.get(turn.sentence_id) ?? null,
          choices: turn.choices.map((choice) => byId.get(choice.sentence_id) ?? null),
        })),
      },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = parsed.values;
    return db.$transaction(async (tx) => {
      const row = await tx.dialogue.findUnique({ where: { id } });
      if (!row) return { state: "gone" as const };
      const stored = (row.turns ?? []) as StoredTurn[];
      const problems: Problem[] = [];
      // Turns are not added or removed here: each one is a set of sentences made by the prompt.
      if (values.turns.length !== stored.length) problems.push(problem("badValue", { value: values.turns.length, field: "turns" }));
      const turns = stored.map((turn, index) => {
        const edit = values.turns[index];
        if (!edit) return turn;
        if (edit.correct < 0 || edit.correct >= turn.choices.length) problems.push(problem("answerOutOfRange", { field: `turns[${index}].correct` }));
        if (!edit.why_fa.trim()) problems.push(problem("missing", { field: `turns[${index}].why_fa` }));
        return { ...turn, speaker: edit.speaker?.trim() || null, correct: edit.correct, why_fa: edit.why_fa.trim() };
      });
      if (problems.length > 0) return { state: "invalid" as const, errors: errorsOf(problems) };
      const data = { title_fa: values.title_fa, situation_fa: values.situation_fa, level: values.level, turns: turns as Prisma.InputJsonValue };
      if (await logEdit(tx, adminId, "dialogues", id, row, data)) await tx.dialogue.update({ where: { id }, data });
      return {
        state: "saved" as const,
        values: { ...values, turns: turns.map((turn) => ({ speaker: turn.speaker, correct: turn.correct, why_fa: turn.why_fa })) },
        notes: [],
      };
    });
  },
};
