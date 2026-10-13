import { joinMp3, readMp3 } from "@/lib/audio/mp3";
import { MAX_MS } from "@/lib/audio/standard";
import { db } from "@/server/db";
import { readMedia, saveMedia } from "@/server/storage";
import type { Tx } from "../kinds/types";
import { logChange } from "../library/log";
import { entityOf } from "../library/slugs";
import { assetKind, readSlot, slotKey, slugOfSlot, writeSlot, type Slot } from "./slots";

/**
 * Putting audio in a slot, taking a human recording out, and marking a recording as heard (PRD §13.8).
 * Files arrive already in the app's format (the browser prepares them); the server only checks that
 * and stores them. A text's file comes with the start of each sentence, or is joined here from its
 * sentences' files.
 */

export type Which = "machine" | "human";
export type StoreResult =
  | { state: "saved"; assetId: number; url: string; durationMs: number }
  | { state: "missing" }
  | { state: "invalid"; reason: "empty" | "notMp3" | "format" | "tooLong" | "offsets" };

/** Sentence starts: one per sentence, the first at 0, rising, all inside the file. */
const validOffsets = (offsets: number[], count: number, durationMs: number) =>
  offsets.length === count && offsets[0] === 0 && offsets.every((value, index) => Number.isInteger(value) && value < durationMs && (index === 0 || value > offsets[index - 1]));

const entityOfSlot = (slot: Slot) => entityOf[slugOfSlot[slot.kind]];

async function logAudio(tx: Tx, adminId: number, slot: Slot, which: Which, before: number | null, after: number | null) {
  await logChange(tx, adminId, {
    action: "audio",
    entity: entityOfSlot(slot),
    entityId: slot.id,
    before: { slot: slotKey(slot), which, asset: before },
    after: { slot: slotKey(slot), which, asset: after },
  });
}

export async function storeAudio(input: {
  slot: Slot;
  bytes: Uint8Array;
  which: Which;
  adminId: number;
  /** The person who recorded it has listened to it already (PRD §13.8). */
  heard?: boolean;
  offsetsMs?: number[];
  voice?: string | null;
}): Promise<StoreResult> {
  const { slot, bytes, which, adminId } = input;
  const state = await readSlot(db, slot);
  if (!state) return { state: "missing" };
  const info = readMp3(bytes);
  if (!info.ok) return { state: "invalid", reason: info.reason };
  if (info.durationMs > MAX_MS[slot.kind]) return { state: "invalid", reason: "tooLong" };
  const offsets = input.offsetsMs ?? [];
  if (slot.kind === "text" && !validOffsets(offsets, state.sentenceIds?.length ?? 0, info.durationMs)) return { state: "invalid", reason: "offsets" };

  const url = await saveMedia("audio", bytes, "mp3");
  return db.$transaction(async (tx) => {
    const now = new Date();
    const asset = await tx.audioAsset.create({
      data: {
        kind: assetKind[slot.kind],
        url,
        source: which === "human" ? "human" : "tts",
        voice: input.voice ?? null,
        duration_ms: info.durationMs,
        uploaded_by: adminId,
        ...(input.heard ? { listened_by: adminId, listened_at: now } : {}),
      },
    });
    const fresh = (await readSlot(tx, slot)) ?? state;
    await writeSlot(tx, slot, which, asset.id, offsets);
    await logAudio(tx, adminId, slot, which, which === "human" ? fresh.humanId : fresh.machineId, asset.id);
    return { state: "saved" as const, assetId: asset.id, url, durationMs: info.durationMs };
  });
}

/** «برداشتن صدای انسانی»: the machine file plays again; the human file stays in the log. */
export async function removeHumanAudio(slot: Slot, adminId: number) {
  return db.$transaction(async (tx) => {
    const state = await readSlot(tx, slot);
    if (!state) return { state: "missing" as const };
    if (state.humanId === null) return { state: "done" as const };
    await writeSlot(tx, slot, "human", null);
    await logAudio(tx, adminId, slot, "human", state.humanId, null);
    return { state: "done" as const };
  });
}

/** «شنیدم، درست است» (PRD §13.4), or taking it back. */
export async function markHeard(assetId: number, adminId: number, heard = true) {
  const found = await db.audioAsset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!found) return { state: "missing" as const };
  await db.audioAsset.update({ where: { id: assetId }, data: heard ? { listened_by: adminId, listened_at: new Date() } : { listened_by: null, listened_at: null } });
  return { state: "done" as const };
}

/**
 * «هم‌زمان‌سازی» again on a text file already stored: only the start of each sentence changes
 * (PRD §13.8).
 */
export async function setTextOffsets(textId: number, which: Which, offsetsMs: number[], adminId: number) {
  return db.$transaction(async (tx) => {
    const state = await readSlot(tx, { kind: "text", id: textId });
    const assetId = which === "human" ? state?.humanId : state?.machineId;
    if (!state || !assetId) return { state: "missing" as const };
    const asset = await tx.audioAsset.findUniqueOrThrow({ where: { id: assetId }, select: { duration_ms: true } });
    if (!validOffsets(offsetsMs, state.sentenceIds?.length ?? 0, asset.duration_ms ?? 0)) return { state: "invalid" as const };
    const column = which === "human" ? "human_sentence_offsets_ms" : "sentence_offsets_ms";
    const row = await tx.text.findUniqueOrThrow({ where: { id: textId }, select: { sentence_offsets_ms: true, human_sentence_offsets_ms: true } });
    const before = row[column];
    if (before.length === offsetsMs.length && before.every((value, index) => value === offsetsMs[index])) return { state: "done" as const };
    await tx.text.update({ where: { id: textId }, data: { [column]: offsetsMs } });
    const slot = slotKey({ kind: "text", id: textId });
    await logChange(tx, adminId, { action: "audio", entity: "text", entityId: textId, before: { slot, which, offsets: before }, after: { slot, which, offsets: offsetsMs } });
    return { state: "done" as const };
  });
}

export type JoinResult = StoreResult | { state: "incomplete"; missing: number[] };

/**
 * A text's file made from its sentences' files, one after another with a short pause, with the start
 * of each sentence (PRD §13.8). Human: every sentence needs a fresh human recording; machine: a fresh
 * machine file. Heard when every sentence file was heard.
 */
export async function joinTextAudio(textId: number, which: Which, adminId: number): Promise<JoinResult> {
  const text = await db.text.findUnique({ where: { id: textId }, select: { sentence_ids: true } });
  if (!text) return { state: "missing" };
  const sentences = await db.sentence.findMany({ where: { id: { in: text.sentence_ids } }, select: { id: true, audio_id: true, human_audio_id: true } });
  const assetIds = new Map(sentences.map((row) => [row.id, which === "human" ? row.human_audio_id : row.audio_id]));
  const assets = new Map(
    (await db.audioAsset.findMany({ where: { id: { in: [...assetIds.values()].filter((id): id is number => id !== null) } } })).map((asset) => [asset.id, asset]),
  );
  const parts: Uint8Array[] = [];
  const missing: number[] = [];
  let heard = true;
  for (const sentenceId of text.sentence_ids) {
    const asset = assets.get(assetIds.get(sentenceId) ?? -1);
    const bytes = asset && !asset.stale ? await readMedia(asset.url) : null;
    if (!asset || !bytes || !readMp3(bytes).ok) {
      missing.push(sentenceId);
      continue;
    }
    heard &&= asset.listened_at !== null;
    parts.push(bytes);
  }
  if (missing.length > 0) return { state: "incomplete", missing };
  const joined = joinMp3(parts);
  const result = await storeAudio({ slot: { kind: "text", id: textId }, bytes: joined.bytes, which, adminId, offsetsMs: joined.offsetsMs });
  if (result.state === "saved" && heard) await markHeard(result.assetId, adminId);
  return result;
}
