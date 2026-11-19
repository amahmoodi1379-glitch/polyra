import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { encodeMp3, readMp3 } from "@/lib/audio/mp3";
import { AUDIO_RATE } from "@/lib/audio/standard";
import { spokenWord } from "@/lib/spoken";
import { MachineGenerator, type Speak } from "@/server/content/audio/generate";
import { audioList } from "@/server/content/audio/lists";
import { machineProgress, releaseLease, takeLease } from "@/server/content/audio/machine";
import { allowMachineAudio, removeMachineAudio, storeAudio, storeMachineAudio } from "@/server/content/audio/store";
import { itemAudio } from "@/server/content/audio/view";
import { levelChecklist } from "@/server/content/publish/levels";
import { readMedia } from "@/server/storage";
import { resetDb, testDb } from "./db";

const storage = mkdtempSync(join(tmpdir(), "polyra-machine-"));
process.env.STORAGE_DIR = storage;

beforeEach(resetDb);
afterAll(async () => {
  await testDb.$disconnect();
  rmSync(storage, { recursive: true, force: true });
});

const ADMIN = 1;
const SIWIS = "fr_FR-siwis-medium";
const PIERRE = "fr_FR-upmc-medium:pierre";

/** A WAV file like Piper's (22,050 Hz, 16-bit), a tone a little longer for a longer line. */
function toneWav(line: string) {
  const rate = 22050;
  const frames = Math.round(rate * Math.min(3, 0.3 + line.length * 0.04));
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, value: string) => [...value].forEach((char, i) => (bytes[at + i] = char.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / rate)), true);
  return bytes;
}

/** A speaking voice for tests: a tone, and a note of who said what. */
function voiceLog() {
  const said: string[] = [];
  const speak: Speak = async (voice, line) => {
    said.push(`${voice.id}|${line}`);
    return toneWav(line);
  };
  return { said, speak };
}

/** Passes until nothing is left to make. */
async function runUntilDone(generator: MachineGenerator) {
  let made = 0;
  for (let round = 0; round < 10; round++) {
    const result = await generator.pass();
    if (result.made === 0) return made;
    made += result.made;
  }
  throw new Error("The generator did not finish");
}

async function word(lemma: string, extra: Record<string, unknown> = {}) {
  return testDb.word.create({ data: { language: "fr", code: lemma, lemma, pos: "noun", gender: "m", level: "A1", meaning_fa: "معنی", status: "approved", ...extra } });
}

async function sentence(text: string, extra: Record<string, unknown> = {}) {
  return testDb.sentence.create({ data: { language: "fr", text, translation_fa: "ترجمه", text_hash: text, level: "A1", status: "approved", ...extra } });
}

const machineOf = async (id: number) => {
  const row = await testDb.word.findUniqueOrThrow({ where: { id } });
  return row.audio_id === null ? null : testDb.audioAsset.findUniqueOrThrow({ where: { id: row.audio_id } });
};

const filesInStorage = () => readdirSync(storage, { recursive: true }).filter((name) => String(name).endsWith(".mp3")).length;

describe("the machine voice fills the panel's places (DECISIONS.md, 18 Nov 2026)", () => {
  it("reads every approved or published word, sentence, text and phonics item, and joins texts from their sentences", async () => {
    const chat = await word("chat");
    const draft = await word("brouillon", { status: "draft" });
    const first = await sentence("Bonjour, Marc.");
    // Not live on its own, but a live text needs it; its spoken form is read.
    const second = await sentence("Salut, Anne !", { status: "draft", tts_text: "Salut Anne !" });
    const text = await testDb.text.create({
      data: {
        language: "fr",
        code: "fr-a1-t001",
        level: "A1",
        band: 1,
        kind: "dialogue",
        title: "Salut",
        status: "published",
        sentence_ids: [first.id, second.id],
        speakers: ["Anne", "Marc"],
      },
    });
    const video = await testDb.text.create({
      data: { language: "fr", code: "fr-a1-t002", level: "A1", band: 1, kind: "video", title: "Vidéo", status: "published", media_type: "video", sentence_ids: [first.id] },
    });
    const lesson = await testDb.phonicsLesson.create({
      data: { language: "fr", kind: "contrast", sound_label: "u و ou", tip_fa: "نکته", status: "approved", minimal_pairs: [{ a: "rue", b: "roue" }] },
    });

    const { said, speak } = voiceLog();
    const generator = new MachineGenerator("test:1", speak);
    expect(await generator.pass()).toEqual({ held: true, made: 5, failed: 0, left: 0 });
    expect(said.sort()).toEqual(
      [`${SIWIS}|${spokenWord(chat)}`, `${SIWIS}|Bonjour, Marc.`, `${PIERRE}|Salut Anne !`, `${SIWIS}|rue`, `${SIWIS}|roue`].sort(),
    );
    // The text's file waits for its sentences', then is their files joined.
    expect(await generator.pass()).toEqual({ held: true, made: 1, failed: 0, left: 0 });
    expect(await generator.pass()).toEqual({ held: true, made: 0, failed: 0, left: 0 });

    const asset = (await machineOf(chat.id))!;
    expect(asset).toEqual(expect.objectContaining({ kind: "word", source: "tts", voice: SIWIS, made_from: spokenWord(chat), stale: false, listened_at: null }));
    const bytes = (await readMedia(asset.url))!;
    const info = readMp3(bytes);
    expect(info.ok && info.durationMs).toBe(asset.duration_ms);
    expect(await machineOf(draft.id)).toBeNull();

    const sentences = await testDb.sentence.findMany({ orderBy: { id: "asc" } });
    const joined = await testDb.text.findUniqueOrThrow({ where: { id: text.id } });
    const textAsset = await testDb.audioAsset.findUniqueOrThrow({ where: { id: joined.audio_id! } });
    expect(textAsset).toEqual(expect.objectContaining({ kind: "text", voice: `${SIWIS}+${PIERRE}`, made_from: `join:${sentences[0].audio_id},${sentences[1].audio_id}` }));
    expect(joined.sentence_offsets_ms).toHaveLength(2);
    expect(joined.sentence_offsets_ms[0]).toBe(0);
    expect(joined.human_audio_id).toBeNull();
    expect((await testDb.text.findUniqueOrThrow({ where: { id: video.id } })).audio_id).toBeNull();

    const pairs = (await testDb.phonicsLesson.findUniqueOrThrow({ where: { id: lesson.id } })).minimal_pairs as Record<string, unknown>[];
    expect(pairs[0]).toEqual(expect.objectContaining({ a: "rue", b: "roue", a_audio_id: expect.any(Number), b_audio_id: expect.any(Number) }));

    const progress = await machineProgress("fr");
    expect(progress.phase).toBe("idle");
    expect(progress.made).toEqual({ words: 1, sentences: 2, texts: 1, phonics: 2 });
    expect(progress.waiting).toEqual({ words: 0, sentences: 0, texts: 0, phonics: 0 });
    expect(progress.lastMadeAt).not.toBeNull();
  });

  it("keeps the teacher's file playing and makes the machine one again when the line changes", async () => {
    const chat = await word("chat");
    const human = await storeAudio({ slot: { kind: "word", id: chat.id }, bytes: encodeMp3(new Float32Array(AUDIO_RATE / 2).fill(0.1)), which: "human", adminId: ADMIN, heard: true });
    if (human.state !== "saved") throw new Error(human.state);
    const generator = new MachineGenerator("test:1", voiceLog().speak);
    expect(await runUntilDone(generator)).toBe(1);
    const before = (await machineOf(chat.id))!;
    expect((await testDb.word.findUniqueOrThrow({ where: { id: chat.id } })).human_audio_id).toBe(human.assetId);

    const view = await itemAudio("words", chat.id);
    if (view?.kind !== "single") throw new Error("not a single place");
    expect(view.slot.playing).toBe("human");
    expect(view.slot.machine).toEqual(expect.objectContaining({ auto: true, voice: SIWIS }));

    await testDb.word.update({ where: { id: chat.id }, data: { lemma: "chaton" } });
    expect(await runUntilDone(generator)).toBe(1);
    const after = (await machineOf(chat.id))!;
    expect(after.id).not.toBe(before.id);
    expect(after.made_from).toBe("un chaton");
    expect((await testDb.word.findUniqueOrThrow({ where: { id: chat.id } })).human_audio_id).toBe(human.assetId);
  });

  it("does not make again a file a teacher took out, until the line changes or the teacher asks", async () => {
    const chat = await word("chat");
    const slot = { kind: "word" as const, id: chat.id };
    const generator = new MachineGenerator("test:1", voiceLog().speak);
    await runUntilDone(generator);
    const made = (await machineOf(chat.id))!;

    expect(await removeMachineAudio(slot, ADMIN)).toEqual({ state: "done" });
    expect(await machineOf(chat.id)).toBeNull();
    expect(await testDb.audioDeclined.findUniqueOrThrow({ where: { slot: `word:${chat.id}` } })).toEqual(
      expect.objectContaining({ made_from: "un chat", declined_by: ADMIN }),
    );
    expect(await testDb.adminLog.findFirstOrThrow({ orderBy: { id: "desc" } })).toEqual(
      expect.objectContaining({ action: "audio", before: { slot: `word:${chat.id}`, which: "machine", asset: made.id }, after: { slot: `word:${chat.id}`, which: "machine", asset: null } }),
    );
    expect(await runUntilDone(generator)).toBe(0);
    expect((await machineProgress("fr")).declined.words).toBe(1);
    const view = await itemAudio("words", chat.id);
    expect(view?.kind === "single" && view.slot.declined).toBe(true);

    expect(await allowMachineAudio(slot)).toEqual({ state: "done" });
    expect(await runUntilDone(generator)).toBe(1);

    await removeMachineAudio(slot, ADMIN);
    await testDb.word.update({ where: { id: chat.id }, data: { lemma: "chaton" } });
    expect(await runUntilDone(generator)).toBe(1);
    expect(await testDb.audioDeclined.count()).toBe(0);
  });

  it("throws a file away when the line changed while it was being made", async () => {
    const chat = await word("chat");
    const bytes = encodeMp3(new Float32Array(AUDIO_RATE / 2).fill(0.1));
    const files = filesInStorage();
    expect(await storeMachineAudio({ slot: { kind: "word", id: chat.id }, bytes, voice: SIWIS, madeFrom: "un chien" })).toEqual({ state: "changed" });
    expect(await storeMachineAudio({ slot: { kind: "word", id: chat.id + 1 }, bytes, voice: SIWIS, madeFrom: "un chat" })).toEqual({ state: "missing" });
    expect(await testDb.audioAsset.count()).toBe(0);
    expect(filesInStorage()).toBe(files);
    expect(await storeMachineAudio({ slot: { kind: "word", id: chat.id }, bytes, voice: SIWIS, madeFrom: "un chat" })).toEqual({ state: "saved", assetId: expect.any(Number) });
  });

  it("lets one generator work at a time", async () => {
    await word("chat");
    expect(await takeLease("server-a", 60_000)).toBe(true);
    expect(await takeLease("server-a", 60_000)).toBe(true);
    expect(await new MachineGenerator("server-b", voiceLog().speak).pass()).toEqual({ held: false, made: 0, failed: 0, left: 0 });
    await releaseLease("server-a");
    expect((await new MachineGenerator("server-b", voiceLog().speak).pass()).made).toBe(1);
  });

  it("waits when a voice is missing, and leaves a line that failed twice", async () => {
    await word("chat");
    const waiting = new MachineGenerator("test:1", voiceLog().speak, { silent: new Set([SIWIS]), missing: ["/opt/piper/bin/piper"] });
    expect(await waiting.pass()).toEqual({ held: true, made: 0, failed: 0, left: 0 });
    expect((await machineProgress("fr")).phase).toBe("unavailable");
    await releaseLease("test:1");

    const errors: string[] = [];
    const broken = new MachineGenerator("test:2", async () => new TextEncoder().encode("not a wav"), {
      onError: async (job, error) => void errors.push(`${job.key}: ${(error as Error).message}`),
    });
    expect((await broken.pass()).failed).toBe(1);
    expect((await broken.pass()).failed).toBe(1);
    expect(await broken.pass()).toEqual({ held: true, made: 0, failed: 0, left: 0 });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^word:\d+: Not a WAV file$/);
    const progress = await machineProgress("fr");
    expect(progress).toEqual(expect.objectContaining({ phase: "idle", failed: 2 }));
    expect(progress.waiting.words).toBe(1);
  });

  it("is off on the panel when no generator has written for ten minutes", async () => {
    await testDb.audioGenerator.create({ data: { id: 1, owner: "old", state: { phase: "working", checkedAt: new Date().toISOString() }, updated_at: new Date(Date.now() - 11 * 60_000) } });
    expect((await machineProgress("fr")).phase).toBe("off");
  });
});

describe("machine files in the panel", () => {
  it("lists them on their own tab; they are never waiting to be heard and never hold a level back", async () => {
    const chat = await word("chat", { status: "published" });
    await runUntilDone(new MachineGenerator("test:1", voiceLog().speak));

    const keys = async (tab: "listen" | "machine") => (await audioList("fr", tab, "words")).items.map((item) => item.key);
    expect(await keys("machine")).toEqual([`word:${chat.id}`]);
    expect(await keys("listen")).toEqual([]);
    const audioLine = async () => (await levelChecklist("fr", "A1")).find((line) => line.key === "audio")!;
    expect((await audioLine()).ok).toBe(true);

    // A machine file someone uploaded is still heard first.
    const asset = (await machineOf(chat.id))!;
    await testDb.audioAsset.update({ where: { id: asset.id }, data: { made_from: null } });
    expect(await keys("machine")).toEqual([]);
    expect(await keys("listen")).toEqual([`word:${chat.id}`]);
    expect((await audioLine()).ok).toBe(false);
  });
});
