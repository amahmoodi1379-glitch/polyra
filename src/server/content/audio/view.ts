import { db } from "@/server/db";
import type { LibrarySlug } from "../library/slugs";
import { phonicsSlots, readSlot, slotKey, type PhonicsPart, type Slot, type SlotState } from "./slots";

/**
 * What the edit page shows about an item's audio (PRD §13.8): each place that holds audio, its machine
 * and human file, which one plays, and whether someone has heard it.
 */

export type AssetView = { id: number; url: string; durationMs: number | null; stale: boolean; heard: boolean; human: boolean };
export type SlotView = {
  key: string;
  kind: Slot["kind"];
  /** The item's id (a phonics lesson's for its items). */
  id: number;
  level: string | null;
  part: PhonicsPart | null;
  index: number | null;
  spoken: string;
  speak: string;
  machine: AssetView | null;
  human: AssetView | null;
  /** The file learners hear: the human one first, never a stale one. */
  playing: "human" | "machine" | null;
};
export type TextSentenceView = { id: number; text: string; slot: SlotView };
export type ItemAudio =
  | { kind: "single"; slot: SlotView }
  | { kind: "text"; slot: SlotView; sentences: TextSentenceView[]; offsets: { machine: number[]; human: number[] } }
  | { kind: "phonics"; groups: { part: "word" | "pair" | "liaison"; slots: SlotView[] }[] };

async function assetsOf(ids: (number | null)[]) {
  const wanted = ids.filter((id): id is number => id !== null);
  if (wanted.length === 0) return new Map<number, AssetView>();
  const rows = await db.audioAsset.findMany({ where: { id: { in: wanted } } });
  return new Map(
    rows.map(
      (row) => [row.id, { id: row.id, url: row.url, durationMs: row.duration_ms, stale: row.stale, heard: row.listened_at !== null, human: row.source === "human" }] as const,
    ),
  );
}

function viewOf(state: SlotState, assets: Map<number, AssetView>): SlotView {
  const machine = state.machineId !== null ? (assets.get(state.machineId) ?? null) : null;
  const human = state.humanId !== null ? (assets.get(state.humanId) ?? null) : null;
  const slot = state.slot;
  return {
    key: slotKey(slot),
    kind: slot.kind,
    id: slot.id,
    level: state.level,
    part: slot.kind === "phonics" ? slot.part : null,
    index: slot.kind === "phonics" ? slot.index : null,
    spoken: state.spoken,
    speak: state.speak,
    machine,
    human,
    playing: human && !human.stale ? "human" : machine && !machine.stale ? "machine" : null,
  };
}

/** The views of the slots that still exist, in the same order. */
export async function viewsOf(slots: Slot[]) {
  const states = (await Promise.all(slots.map((slot) => readSlot(db, slot)))).filter((state): state is SlotState => state !== null);
  const assets = await assetsOf(states.flatMap((state) => [state.machineId, state.humanId]));
  return states.map((state) => viewOf(state, assets));
}

/** The audio of an item on its edit page, or null for a type that has no audio of its own. */
export async function itemAudio(slug: LibrarySlug, id: number): Promise<ItemAudio | null> {
  switch (slug) {
    case "words":
    case "sentences": {
      const [slot] = await viewsOf([{ kind: slug === "words" ? "word" : "sentence", id }]);
      return slot ? { kind: "single", slot } : null;
    }
    case "texts": {
      const text = await db.text.findUnique({ where: { id }, select: { sentence_ids: true, sentence_offsets_ms: true, human_sentence_offsets_ms: true } });
      if (!text) return null;
      const [slot, ...sentenceSlots] = await viewsOf([{ kind: "text", id }, ...text.sentence_ids.map((sentenceId) => ({ kind: "sentence" as const, id: sentenceId }))]);
      const bySentence = new Map(sentenceSlots.map((view) => [view.id, view]));
      const sentences = text.sentence_ids.flatMap((sentenceId) => {
        const view = bySentence.get(sentenceId);
        return view ? [{ id: sentenceId, text: view.spoken, slot: view }] : [];
      });
      return {
        kind: "text",
        slot: { ...slot, speak: sentences.map((sentence) => sentence.slot.speak).join(" ") },
        sentences,
        offsets: { machine: text.sentence_offsets_ms, human: text.human_sentence_offsets_ms },
      };
    }
    case "phonics": {
      const lesson = await db.phonicsLesson.findUnique({ where: { id }, select: { id: true, example_words: true, minimal_pairs: true, liaison_sentences: true } });
      if (!lesson) return null;
      const views = await viewsOf(phonicsSlots(lesson));
      const groups = (["word", "pair", "liaison"] as const)
        .map((part) => ({ part, slots: views.filter((view) => (part === "pair" ? view.part === "pair-a" || view.part === "pair-b" : view.part === part)) }))
        .filter((group) => group.slots.length > 0);
      return { kind: "phonics", groups };
    }
    default:
      return null;
  }
}
