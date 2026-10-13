import type { AudioKind, ContentStatus, Prisma } from "@/generated/prisma/client";
import { spokenWord } from "@/lib/spoken";
import type { Tx } from "../kinds/types";
import type { LibrarySlug } from "../library/slugs";

/**
 * A place that holds audio (PRD §13.8): a word, a sentence, a text, or one item of a phonics lesson
 * (an example word, one side of a minimal pair, a liaison sentence). Each has a machine file and an
 * optional human one; the human one plays first.
 */

export const phonicsParts = ["word", "pair-a", "pair-b", "liaison"] as const;
export type PhonicsPart = (typeof phonicsParts)[number];
export type Slot = { kind: "word" | "sentence" | "text"; id: number } | { kind: "phonics"; id: number; part: PhonicsPart; index: number };

export const slotKey = (slot: Slot) => (slot.kind === "phonics" ? `phonics:${slot.id}:${slot.part}:${slot.index}` : `${slot.kind}:${slot.id}`);

export function parseSlot(key: string): Slot | null {
  const plain = /^(word|sentence|text):(\d+)$/.exec(key);
  if (plain) return { kind: plain[1] as "word" | "sentence" | "text", id: Number(plain[2]) };
  const lesson = /^phonics:(\d+):(word|pair-a|pair-b|liaison):(\d+)$/.exec(key);
  if (lesson) return { kind: "phonics", id: Number(lesson[1]), part: lesson[2] as PhonicsPart, index: Number(lesson[3]) };
  return null;
}

const listOf: Record<PhonicsPart, "example_words" | "minimal_pairs" | "liaison_sentences"> = {
  word: "example_words",
  "pair-a": "minimal_pairs",
  "pair-b": "minimal_pairs",
  liaison: "liaison_sentences",
};
const prefixOf: Record<PhonicsPart, string> = { word: "", "pair-a": "a_", "pair-b": "b_", liaison: "" };
export const assetKind: Record<Slot["kind"], AudioKind> = { word: "word", sentence: "sentence", text: "text", phonics: "phonics" };
export const slugOfSlot: Record<Slot["kind"], LibrarySlug> = { word: "words", sentence: "sentences", text: "texts", phonics: "phonics" };

export type SlotState = {
  slot: Slot;
  language: string;
  level: string | null;
  status: ContentStatus;
  suspended: boolean;
  /** What the recording says, in the target language. */
  spoken: string;
  /** What the phone's voice reads when there is no file: a sentence's spoken form if it has one (PRD §13.8). */
  speak: string;
  machineId: number | null;
  humanId: number | null;
  /** A text's sentences, in order (for the start of each sentence). */
  sentenceIds?: number[];
};

type Entry = Record<string, unknown>;
const entries = (value: unknown) => (Array.isArray(value) ? (value as Entry[]) : []);

/** The phonics item a slot points at and what it says. */
function phonicsEntry(row: Record<string, unknown>, part: PhonicsPart, index: number) {
  const entry = entries(row[listOf[part]])[index];
  if (!entry) return null;
  const spoken = part === "pair-a" ? entry.a : part === "pair-b" ? entry.b : entry.text;
  return { entry, spoken: String(spoken ?? "") };
}

export async function readSlot(tx: Tx, slot: Slot): Promise<SlotState | null> {
  const base = { slot } as const;
  switch (slot.kind) {
    case "word": {
      const row = await tx.word.findUnique({ where: { id: slot.id } });
      return row
        ? {
            ...base,
            language: row.language,
            level: row.level,
            status: row.status,
            suspended: row.suspended,
            spoken: spokenWord(row),
            speak: spokenWord(row),
            machineId: row.audio_id,
            humanId: row.human_audio_id,
          }
        : null;
    }
    case "sentence": {
      const row = await tx.sentence.findUnique({ where: { id: slot.id } });
      return row
        ? {
            ...base,
            language: row.language,
            level: row.level,
            status: row.status,
            suspended: row.suspended,
            spoken: row.text,
            speak: row.tts_text?.trim() || row.text,
            machineId: row.audio_id,
            humanId: row.human_audio_id,
          }
        : null;
    }
    case "text": {
      const row = await tx.text.findUnique({ where: { id: slot.id } });
      return row
        ? {
            ...base,
            language: row.language,
            level: row.level,
            status: row.status,
            suspended: row.suspended,
            spoken: row.title,
            // Read sentence by sentence; the edit page puts the sentences together.
            speak: row.title,
            machineId: row.audio_id,
            humanId: row.human_audio_id,
            sentenceIds: row.sentence_ids,
          }
        : null;
    }
    case "phonics": {
      const row = await tx.phonicsLesson.findUnique({ where: { id: slot.id } });
      const found = row ? phonicsEntry(row as unknown as Record<string, unknown>, slot.part, slot.index) : null;
      if (!row || !found) return null;
      const prefix = prefixOf[slot.part];
      return {
        ...base,
        language: row.language,
        level: null,
        status: row.status,
        suspended: row.suspended,
        spoken: found.spoken,
        speak: found.spoken,
        machineId: (found.entry[`${prefix}audio_id`] as number | null) ?? null,
        humanId: (found.entry[`${prefix}human_audio_id`] as number | null) ?? null,
      };
    }
  }
}

/** Puts a file in a slot (or empties it with null). A text also takes the start of each sentence. */
export async function writeSlot(tx: Tx, slot: Slot, which: "machine" | "human", assetId: number | null, offsetsMs: number[] = []) {
  const column = which === "machine" ? "audio_id" : "human_audio_id";
  switch (slot.kind) {
    case "word":
      return void (await tx.word.update({ where: { id: slot.id }, data: { [column]: assetId } }));
    case "sentence":
      return void (await tx.sentence.update({ where: { id: slot.id }, data: { [column]: assetId } }));
    case "text": {
      const offsets = which === "machine" ? "sentence_offsets_ms" : "human_sentence_offsets_ms";
      return void (await tx.text.update({ where: { id: slot.id }, data: { [column]: assetId, [offsets]: assetId === null ? [] : offsetsMs } }));
    }
    case "phonics": {
      const row = await tx.phonicsLesson.findUniqueOrThrow({ where: { id: slot.id } });
      const name = listOf[slot.part];
      const list = entries(row[name]).map((entry) => ({ ...entry }));
      if (!list[slot.index]) throw new Error(`Phonics item ${slotKey(slot)} is gone`);
      list[slot.index][`${prefixOf[slot.part]}${column}`] = assetId;
      return void (await tx.phonicsLesson.update({ where: { id: slot.id }, data: { [name]: list as Prisma.InputJsonValue } }));
    }
  }
}

/** Every slot of a phonics lesson, in the lesson's order. */
export function phonicsSlots(lesson: { id: number; example_words: unknown; minimal_pairs: unknown; liaison_sentences: unknown }): Slot[] {
  return [
    ...entries(lesson.example_words).map((_, index) => ({ kind: "phonics" as const, id: lesson.id, part: "word" as const, index })),
    ...entries(lesson.minimal_pairs).flatMap((_, index) => [
      { kind: "phonics" as const, id: lesson.id, part: "pair-a" as const, index },
      { kind: "phonics" as const, id: lesson.id, part: "pair-b" as const, index },
    ]),
    ...entries(lesson.liaison_sentences).map((_, index) => ({ kind: "phonics" as const, id: lesson.id, part: "liaison" as const, index })),
  ];
}
