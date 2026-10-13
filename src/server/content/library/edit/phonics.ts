import { z } from "zod";
import type { PhonicsKind, Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { filled } from "@/schemas/common";
import { db } from "@/server/db";
import { checkLesson } from "../../kinds/phonics";
import { problem } from "../../problems";
import { errorsOf, logEdit, parseValues, staleAudio } from "./shared";
import { viewOf, type Editor } from "./types";

const schema = z.object({
  sound_label: filled,
  graphemes: z.array(z.string()).transform((list) => list.map((item) => item.trim()).filter(Boolean)),
  tip_fa: filled,
  example_words: z.array(z.object({ text: filled, meaning_fa: filled, wrong_spellings: z.array(z.string()) })),
  minimal_pairs: z.array(z.object({ a: filled, b: filled, a_fa: filled, b_fa: filled })),
  liaison_sentences: z.array(z.object({ text: filled, liaison_after_word_index: z.array(z.number().int().min(0)) })),
});
export type PhonicsValues = z.output<typeof schema>;
export type PhonicsContext = { kind: PhonicsKind; orderNo: number | null };

type Stored = Record<string, unknown>;
const key = (...parts: unknown[]) => parts.map((part) => fold(String(part ?? "")).trim()).join("|");
const audioIds = (item: Stored) => Object.entries(item).filter(([name]) => name.endsWith("audio_id")).map(([, value]) => value as number | null);

/**
 * New items keep the audio of an old item with the same text (so moving or editing a meaning keeps
 * it); audio of items whose text is gone is marked stale (PRD §13.7).
 */
function carryAudio<T extends Stored>(items: T[], old: Stored[], keyOf: (item: Stored) => string) {
  const left = [...old];
  const merged = items.map((item) => {
    const index = left.findIndex((candidate) => keyOf(candidate) === keyOf(item));
    if (index < 0) return item as Stored;
    const [match] = left.splice(index, 1);
    const audio = Object.fromEntries(Object.entries(match).filter(([name]) => name.endsWith("audio_id")));
    return { ...item, ...audio };
  });
  return { merged, stale: left.flatMap(audioIds) };
}

/**
 * A phonics lesson (PRD §8.1): name, letters, tip and the lists of its kind, with the same counts as
 * import (PRD §13.3). Kind and order come from the teacher's list and are not edited here.
 */
export const phonicsEditor: Editor<PhonicsValues, PhonicsContext> = {
  async load(id) {
    const row = await db.phonicsLesson.findUnique({ where: { id } });
    if (!row) return null;
    const words = (row.example_words ?? []) as PhonicsValues["example_words"];
    return {
      language: row.language,
      view: viewOf(row, row.sound_label, "fa", null),
      values: {
        sound_label: row.sound_label,
        graphemes: row.graphemes,
        tip_fa: row.tip_fa,
        example_words: words.map((word) => ({ text: word.text, meaning_fa: word.meaning_fa, wrong_spellings: [...word.wrong_spellings] })),
        minimal_pairs: ((row.minimal_pairs ?? []) as PhonicsValues["minimal_pairs"]).map(({ a, b, a_fa, b_fa }) => ({ a, b, a_fa, b_fa })),
        liaison_sentences: ((row.liaison_sentences ?? []) as PhonicsValues["liaison_sentences"]).map(({ text, liaison_after_word_index }) => ({
          text,
          liaison_after_word_index,
        })),
      },
      context: { kind: row.kind, orderNo: row.order_no },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    return db.$transaction(async (tx) => {
      const row = await tx.phonicsLesson.findUnique({ where: { id } });
      if (!row) return { state: "gone" as const };
      const kind = row.kind;
      const values: PhonicsValues = {
        ...parsed.values,
        example_words: kind === "liaison" ? [] : parsed.values.example_words.map((word) => ({ ...word, wrong_spellings: word.wrong_spellings.map((item) => item.trim()) })),
        minimal_pairs: kind === "contrast" ? parsed.values.minimal_pairs : [],
        liaison_sentences: kind === "liaison" ? parsed.values.liaison_sentences : [],
      };
      const problems = checkLesson({ ...values, kind }, kind);
      const twin = (await tx.phonicsLesson.findMany({ where: { language: row.language, id: { not: id }, status: { not: "retired" } }, select: { sound_label: true } })).some(
        (other) => key(other.sound_label) === key(values.sound_label),
      );
      if (twin) problems.push(problem("sameItemExists", { field: "sound_label" }));
      if (problems.length > 0) return { state: "invalid" as const, errors: errorsOf(problems) };

      const words = carryAudio(values.example_words, (row.example_words ?? []) as Stored[], (item) => key(item.text));
      const pairs = carryAudio(values.minimal_pairs, (row.minimal_pairs ?? []) as Stored[], (item) => key(item.a, item.b));
      const sentences = carryAudio(values.liaison_sentences, (row.liaison_sentences ?? []) as Stored[], (item) => key(item.text));
      const data = {
        sound_label: values.sound_label,
        graphemes: values.graphemes,
        tip_fa: values.tip_fa,
        example_words: words.merged as Prisma.InputJsonValue,
        minimal_pairs: pairs.merged as Prisma.InputJsonValue,
        liaison_sentences: sentences.merged as Prisma.InputJsonValue,
      };
      if (await logEdit(tx, adminId, "phonics", id, row, data)) {
        await tx.phonicsLesson.update({ where: { id }, data });
        await staleAudio(tx, [...words.stale, ...pairs.stale, ...sentences.stale]);
      }
      return { state: "saved" as const, values, notes: [] };
    });
  },
};
