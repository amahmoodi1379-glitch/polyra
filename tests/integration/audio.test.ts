import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { t } from "@/i18n";
import { encodeMp3, readMp3 } from "@/lib/audio/mp3";
import { AUDIO_RATE, TEXT_GAP_MS } from "@/lib/audio/standard";
import { audioCounts, audioList } from "@/server/content/audio/lists";
import { matchFiles } from "@/server/content/audio/match";
import { joinTextAudio, markHeard, removeHumanAudio, setTextOffsets, storeAudio } from "@/server/content/audio/store";
import { itemAudio } from "@/server/content/audio/view";
import { wordEditor } from "@/server/content/library/edit/words";
import { listLog } from "@/server/content/library/history";
import { readMedia } from "@/server/storage";
import { resetDb, testDb } from "./db";

const storage = mkdtempSync(join(tmpdir(), "polyra-audio-"));
process.env.STORAGE_DIR = storage;

beforeEach(resetDb);
afterAll(async () => {
  await testDb.$disconnect();
  rmSync(storage, { recursive: true, force: true });
});

const ADMIN = 1;
const lastLog = () => testDb.adminLog.findFirstOrThrow({ orderBy: { id: "desc" } });

/** A recording of `ms` milliseconds in the app's format. */
function recording(ms: number) {
  const pcm = new Float32Array(Math.round((ms / 1000) * AUDIO_RATE));
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.2 * Math.sin((2 * Math.PI * 330 * i) / AUDIO_RATE);
  return encodeMp3(pcm);
}

async function word(code: string, extra: Record<string, unknown> = {}) {
  return testDb.word.create({ data: { language: "fr", code, lemma: code, pos: "noun", gender: "m", level: "A1", meaning_fa: "معنی", ...extra } });
}

async function sentence(text: string, extra: Record<string, unknown> = {}) {
  return testDb.sentence.create({ data: { language: "fr", text, translation_fa: "ترجمه", text_hash: text, level: "A1", ...extra } });
}

async function file(extra: { stale?: boolean; listened_at?: Date | null; source?: "human" | "tts" } = {}) {
  return (await testDb.audioAsset.create({ data: { kind: "word", url: "test://audio.mp3", source: "human", duration_ms: 900, ...extra } })).id;
}

describe("a place's recording (PRD §13.8)", () => {
  it("stores a recording, logs it, and takes it out again", async () => {
    const homme = await word("homme");
    const bytes = recording(800);
    const saved = await storeAudio({ slot: { kind: "word", id: homme.id }, bytes, which: "human", adminId: ADMIN, heard: true });
    if (saved.state !== "saved") throw new Error(saved.state);

    expect((await testDb.word.findUniqueOrThrow({ where: { id: homme.id } })).human_audio_id).toBe(saved.assetId);
    const asset = await testDb.audioAsset.findUniqueOrThrow({ where: { id: saved.assetId } });
    expect(asset).toEqual(expect.objectContaining({ kind: "word", source: "human", uploaded_by: ADMIN, listened_by: ADMIN, stale: false }));
    expect(asset.duration_ms).toBe((readMp3(bytes) as { durationMs: number }).durationMs);
    expect(await readMedia(saved.url)).toEqual(bytes);
    expect(await lastLog()).toEqual(
      expect.objectContaining({
        action: "audio",
        entity: "word",
        entity_id: String(homme.id),
        before: { slot: `word:${homme.id}`, which: "human", asset: null },
        after: { slot: `word:${homme.id}`, which: "human", asset: saved.assetId },
      }),
    );

    expect(await markHeard(saved.assetId, ADMIN, false)).toEqual({ state: "done" });
    expect((await testDb.audioAsset.findUniqueOrThrow({ where: { id: saved.assetId } })).listened_at).toBeNull();

    expect(await removeHumanAudio({ kind: "word", id: homme.id }, ADMIN)).toEqual({ state: "done" });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: homme.id } })).human_audio_id).toBeNull();
    const log = await listLog("words", 1);
    expect(log.items.map((item) => [item.lines[0].note, item.revert])).toEqual([
      [t("admin.log.audio.removed"), "no"],
      [t("admin.log.audio.added"), "no"],
    ]);
  });

  it("refuses a file that is not in the format, too long, or for a place that is gone", async () => {
    const homme = await word("homme");
    const slot = { kind: "word" as const, id: homme.id };
    expect(await storeAudio({ slot, bytes: new TextEncoder().encode("RIFF....WAVEfmt "), which: "human", adminId: ADMIN })).toEqual({ state: "invalid", reason: "notMp3" });
    expect(await storeAudio({ slot, bytes: recording(16_000), which: "human", adminId: ADMIN })).toEqual({ state: "invalid", reason: "tooLong" });
    expect(await storeAudio({ slot: { kind: "word", id: homme.id + 1 }, bytes: recording(500), which: "human", adminId: ADMIN })).toEqual({ state: "missing" });
    expect(await testDb.audioAsset.count()).toBe(0);
  });

  it("puts a recording in a phonics lesson's item", async () => {
    const lesson = await testDb.phonicsLesson.create({
      data: { language: "fr", kind: "contrast", sound_label: "u و ou", tip_fa: "نکته", minimal_pairs: [{ a: "rue", b: "roue" }] },
    });
    const saved = await storeAudio({ slot: { kind: "phonics", id: lesson.id, part: "pair-b", index: 0 }, bytes: recording(600), which: "human", adminId: ADMIN });
    if (saved.state !== "saved") throw new Error(saved.state);
    const pairs = (await testDb.phonicsLesson.findUniqueOrThrow({ where: { id: lesson.id } })).minimal_pairs as Record<string, unknown>[];
    expect(pairs[0]).toEqual({ a: "rue", b: "roue", b_human_audio_id: saved.assetId });

    const view = await itemAudio("phonics", lesson.id);
    if (view?.kind !== "phonics") throw new Error("not phonics");
    expect(view.groups.map((group) => [group.part, group.slots.map((slot) => [slot.spoken, slot.playing])])).toEqual([
      [
        "pair",
        [
          ["rue", null],
          ["roue", "human"],
        ],
      ],
    ]);
  });
});

describe("a text's file (PRD §13.8)", () => {
  async function textOf(lines: string[]) {
    const rows = [];
    for (const line of lines) rows.push(await sentence(line));
    const text = await testDb.text.create({
      data: { language: "fr", code: "fr-a1-t001", level: "A1", band: 1, kind: "dialogue", title: "Au café", sentence_ids: rows.map((row) => row.id) },
    });
    return { text, sentences: rows };
  }

  it("takes a whole file only with the start of each sentence, and syncs it again", async () => {
    const { text } = await textOf(["Bonjour.", "Un café, s'il vous plaît."]);
    const slot = { kind: "text" as const, id: text.id };
    const bytes = recording(3000);
    expect(await storeAudio({ slot, bytes, which: "human", adminId: ADMIN })).toEqual({ state: "invalid", reason: "offsets" });
    expect(await storeAudio({ slot, bytes, which: "human", adminId: ADMIN, offsetsMs: [0, 5000] })).toEqual({ state: "invalid", reason: "offsets" });
    expect((await storeAudio({ slot, bytes, which: "human", adminId: ADMIN, offsetsMs: [0, 1500] })).state).toBe("saved");
    expect((await testDb.text.findUniqueOrThrow({ where: { id: text.id } })).human_sentence_offsets_ms).toEqual([0, 1500]);

    expect(await setTextOffsets(text.id, "human", [0, 1200], ADMIN)).toEqual({ state: "done" });
    expect((await testDb.text.findUniqueOrThrow({ where: { id: text.id } })).human_sentence_offsets_ms).toEqual([0, 1200]);
    expect((await lastLog()).before).toEqual({ slot: `text:${text.id}`, which: "human", offsets: [0, 1500] });
    expect((await listLog("texts", 1)).items[0].lines[0].note).toBe(t("admin.log.audio.synced"));
    expect(await setTextOffsets(text.id, "human", [100, 1200], ADMIN)).toEqual({ state: "invalid" });
    expect(await setTextOffsets(text.id, "machine", [0, 1200], ADMIN)).toEqual({ state: "missing" });
  });

  it("joins a text's file from its sentences' recordings", async () => {
    const { text, sentences } = await textOf(["Bonjour.", "Un café."]);
    expect(await joinTextAudio(text.id, "human", ADMIN)).toEqual({ state: "incomplete", missing: sentences.map((row) => row.id) });

    const first = await storeAudio({ slot: { kind: "sentence", id: sentences[0].id }, bytes: recording(700), which: "human", adminId: ADMIN, heard: true });
    const second = await storeAudio({ slot: { kind: "sentence", id: sentences[1].id }, bytes: recording(900), which: "human", adminId: ADMIN });
    if (first.state !== "saved" || second.state !== "saved") throw new Error("not saved");

    const joined = await joinTextAudio(text.id, "human", ADMIN);
    if (joined.state !== "saved") throw new Error(joined.state);
    const row = await testDb.text.findUniqueOrThrow({ where: { id: text.id } });
    expect(row.human_audio_id).toBe(joined.assetId);
    expect(row.human_sentence_offsets_ms[0]).toBe(0);
    expect(row.human_sentence_offsets_ms[1]).toBeGreaterThanOrEqual(first.durationMs + TEXT_GAP_MS);
    // One sentence was not heard yet, so the whole file is not either.
    expect((await testDb.audioAsset.findUniqueOrThrow({ where: { id: joined.assetId } })).listened_at).toBeNull();

    await markHeard(second.assetId, ADMIN);
    const heard = await joinTextAudio(text.id, "human", ADMIN);
    if (heard.state !== "saved") throw new Error(heard.state);
    expect((await testDb.audioAsset.findUniqueOrThrow({ where: { id: heard.assetId } })).listened_at).not.toBeNull();

    await testDb.audioAsset.update({ where: { id: first.assetId }, data: { stale: true } });
    expect(await joinTextAudio(text.id, "human", ADMIN)).toEqual({ state: "incomplete", missing: [sentences[0].id] });
  });

  it("shows the text with its sentences, read by the phone in their spoken form", async () => {
    const { text, sentences } = await textOf(["Bonjour.", "Il a 3 ans."]);
    await testDb.sentence.update({ where: { id: sentences[1].id }, data: { tts_text: "Il a trois ans." } });
    const view = await itemAudio("texts", text.id);
    if (view?.kind !== "text") throw new Error("not a text");
    expect(view.slot.speak).toBe("Bonjour. Il a trois ans.");
    expect(view.sentences.map((item) => [item.text, item.slot.speak])).toEqual([
      ["Bonjour.", "Bonjour."],
      ["Il a 3 ans.", "Il a trois ans."],
    ]);
  });
});

describe("the «صدا» page (PRD §13.2, §13.8)", () => {
  it("lists files to hear, stale files and places with no file", async () => {
    await word("a");
    const toHear = await word("b", { human_audio_id: await file({ listened_at: null }) });
    await word("c", { human_audio_id: await file({ listened_at: new Date() }) });
    const stale = await word("d", { human_audio_id: await file({ stale: true }) });
    // A stale human file over a fresh, heard machine one: the machine one plays, so nothing to do.
    await word("e", { human_audio_id: await file({ stale: true }), audio_id: await file({ source: "tts", listened_at: new Date() }) });
    await testDb.phonicsLesson.create({ data: { language: "fr", kind: "rule", sound_label: "r", tip_fa: "نکته", example_words: [{ text: "rue" }] } });

    const counts = await audioCounts("fr");
    expect(counts.listen).toEqual({ words: 1, sentences: 0, texts: 0, phonics: 0 });
    expect(counts.stale).toEqual({ words: 1, sentences: 0, texts: 0, phonics: 0 });
    expect(counts.none).toEqual({ words: 1, sentences: 0, texts: 0, phonics: 1 });
    expect((await audioList("fr", "listen", "words")).items.map((item) => [item.key, item.playing])).toEqual([[`word:${toHear.id}`, "human"]]);
    expect((await audioList("fr", "stale", "words")).items.map((item) => [item.key, item.playing])).toEqual([[`word:${stale.id}`, null]]);
    expect((await audioList("fr", "none", "phonics")).items.map((item) => item.spoken)).toEqual(["rue"]);
  });

  it("finds each file's place from its name", async () => {
    const homme = await word("homme");
    const vous = await word("vous", { pos: "pron", gender: null });
    const madame = await sentence("Bonjour, madame !");
    const text = await testDb.text.create({ data: { language: "fr", code: "fr-a1-t001", level: "A1", band: 1, kind: "dialogue", title: "Au café", sentence_ids: [madame.id] } });
    const lesson = await testDb.phonicsLesson.create({ data: { language: "fr", kind: "rule", sound_label: "v", tip_fa: "نکته", example_words: [{ text: "vous" }] } });

    const found = await matchFiles("fr", ["Un homme.mp3", "bonjour madame.wav", "fr-a1-t001.m4a", `word_${homme.id}.mp3`, "vous.mp3", "bonjour madme.mp3", "zzz.mp3"]);
    expect(found.map((item) => [item.match?.key ?? null, item.candidates.map((candidate) => candidate.key)])).toEqual([
      [`word:${homme.id}`, []],
      [`sentence:${madame.id}`, []],
      [`text:${text.id}`, []],
      [`word:${homme.id}`, []],
      [null, [`word:${vous.id}`, `phonics:${lesson.id}:word:0`]],
      [null, [`sentence:${madame.id}`]],
      [null, []],
    ]);
  });
});

describe("editing an item with a file (PRD §13.7, §13.8)", () => {
  it("makes a word's file stale only when what it says changes", async () => {
    const voiture = await word("voiture", { gender: "f", human_audio_id: await file({ listened_at: new Date() }) });
    const loaded = (await wordEditor.load(voiture.id))!;
    expect((await wordEditor.save(voiture.id, { ...loaded.values, meaning_fa: "ماشین", concept_fa: "ماشین" }, ADMIN)).state).toBe("saved");
    expect((await testDb.audioAsset.findUniqueOrThrow({ where: { id: voiture.human_audio_id! } })).stale).toBe(false);

    const again = (await wordEditor.load(voiture.id))!;
    expect((await wordEditor.save(voiture.id, { ...again.values, gender: "m" }, ADMIN)).state).toBe("saved");
    expect((await testDb.audioAsset.findUniqueOrThrow({ where: { id: voiture.human_audio_id! } })).stale).toBe(true);
  });
});
