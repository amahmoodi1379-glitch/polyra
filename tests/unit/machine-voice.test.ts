import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resample } from "@/lib/audio/resample";
import { allVoices, machineVoices, spokenLine, voiceById, voiceFor, voiceLicences } from "@/lib/audio/voices";
import { readWav } from "@/lib/audio/wav";
import { joinSignature, planMachineAudio, sentenceRoles, type MachineFile, type PlanSlot } from "@/server/content/audio/machine";

const SIWIS = "fr_FR-siwis-medium";
const PIERRE = "fr_FR-upmc-medium:pierre";

function word(id: number, speak: string, extra: Partial<PlanSlot> = {}): PlanSlot {
  return { slot: { kind: "word", id }, language: "fr", level: "A1", order: id, speak, role: 0, machine: null, humanPlays: false, declined: null, ...extra };
}
function sentence(id: number, speak: string, extra: Partial<PlanSlot> = {}): PlanSlot {
  return { ...word(id, speak, extra), slot: { kind: "sentence", id } };
}
function text(id: number, sentenceIds: number[], extra: Partial<PlanSlot> = {}): PlanSlot {
  return { ...word(id, "", extra), slot: { kind: "text", id }, sentenceIds };
}
const made = (id: number, madeFrom: string | null, voice: string | null = SIWIS, stale = false): MachineFile => ({ id, stale, madeFrom, voice });
const keys = (slots: PlanSlot[]) => planMachineAudio(slots).jobs.map((job) => job.key);

describe("the machine voice's to-do list (DECISIONS.md, 18 Nov 2026)", () => {
  it("reads each place that has nothing, with the language's first voice", () => {
    const plan = planMachineAudio([word(1, "le  chat"), sentence(2, "Il dort.")]);
    expect(plan.jobs).toEqual([
      { kind: "say", slot: { kind: "word", id: 1 }, key: "word:1", language: "fr", voice: SIWIS, text: "le chat" },
      { kind: "say", slot: { kind: "sentence", id: 2 }, key: "sentence:2", language: "fr", voice: SIWIS, text: "Il dort." },
    ]);
    expect(plan.languages.fr.waiting).toEqual({ words: 1, sentences: 1, texts: 0, phonics: 0 });
  });

  it("leaves a fresh file alone and makes one again when the line, the voice or the file changed", () => {
    const plan = planMachineAudio([
      word(1, "le chat", { machine: made(11, "le chat") }),
      word(2, "le chien", { machine: made(12, "la chienne") }),
      word(3, "la maison", { machine: made(13, "la maison", PIERRE) }),
      word(4, "le pain", { machine: made(14, "le pain", SIWIS, true) }),
    ]);
    expect(plan.jobs.map((job) => job.key)).toEqual(["word:2", "word:3", "word:4"]);
    expect(plan.languages.fr.made.words).toBe(1);
    expect(plan.languages.fr.waiting.words).toBe(3);
  });

  it("keeps a machine file someone uploaded until it goes stale", () => {
    expect(keys([word(1, "le chat", { machine: made(11, null, null) })])).toEqual([]);
    expect(keys([word(1, "le chat", { machine: made(11, null, null, true) })])).toEqual(["word:1"]);
  });

  it("does not make again what a teacher took out, until the line changes", () => {
    const plan = planMachineAudio([word(1, "le chat", { declined: "le chat" }), word(2, "le chien", { declined: "la chienne" })]);
    expect(plan.jobs.map((job) => job.key)).toEqual(["word:2"]);
    expect(plan.languages.fr.declined.words).toBe(1);
  });

  it("skips what has nothing to say and languages without a voice", () => {
    expect(keys([word(1, "…"), word(2, "  "), word(3, "12"), word(4, "hola", { language: "es" })])).toEqual([]);
  });

  it("reads the second speaker with the second voice", () => {
    const plan = planMachineAudio([sentence(1, "Bonjour !", { role: 1 }), sentence(2, "Hallo!", { language: "de", role: 1 }), sentence(3, "Danke.", { language: "de" })]);
    expect(plan.jobs.map((job) => job.kind === "say" && job.voice)).toEqual([PIERRE, "de_DE-kerstin-medium", "de_DE-thorsten-medium"]);
  });

  it("joins a text once every sentence has a fresh file", () => {
    const sentences = [sentence(1, "Bonjour.", { machine: made(21, "Bonjour.") }), sentence(2, "Ça va ?")];
    const waiting = planMachineAudio([...sentences, text(5, [1, 2])]);
    expect(waiting.jobs.map((job) => job.key)).toEqual(["sentence:2"]);
    expect(waiting.languages.fr.waiting.texts).toBe(1);

    sentences[1] = sentence(2, "Ça va ?", { machine: made(22, "Ça va ?") });
    const ready = planMachineAudio([...sentences, text(5, [1, 2])]);
    expect(ready.jobs).toEqual([{ kind: "join", slot: { kind: "text", id: 5 }, key: "text:5", language: "fr", parts: [21, 22], madeFrom: "join:21,22" }]);

    // Made from these files: nothing to do. A sentence file made again: join again.
    expect(keys([...sentences, text(5, [1, 2], { machine: made(30, joinSignature([21, 22])) })])).toEqual([]);
    expect(keys([...sentences, text(5, [1, 2], { machine: made(30, joinSignature([21, 20])) })])).toEqual(["text:5"]);
    // Taken out by a teacher from these very files: not again.
    expect(keys([...sentences, text(5, [1, 2], { declined: "join:21,22" })])).toEqual([]);
  });

  it("makes no text file when a sentence is missing, says nothing, or was taken out", () => {
    const one = sentence(1, "Bonjour.", { machine: made(21, "Bonjour.") });
    expect(keys([one, text(5, [1, 3])])).toEqual([]);
    expect(keys([one, sentence(2, "…"), text(5, [1, 2])])).toEqual([]);
    const plan = planMachineAudio([one, sentence(2, "Salut.", { declined: "Salut." }), text(5, [1, 2])]);
    expect(plan.jobs).toEqual([]);
    expect(plan.languages.fr.waiting.texts).toBe(0);
    expect(keys([text(6, [])])).toEqual([]);
  });

  it("does places nothing plays for first, then by level, kind and lesson order", () => {
    const slots = [
      sentence(1, "Une phrase A1."),
      word(2, "un mot B1", { level: "B1" }),
      word(3, "un mot A1 enregistré", { humanPlays: true }),
      word(4, "un mot A1 plus tard", { order: 40 }),
      word(5, "un mot A1 plus tôt", { order: 4 }),
      { ...word(6, "rue", { level: null }), slot: { kind: "phonics" as const, id: 6, part: "pair-a" as const, index: 0 } },
    ];
    // The alphabet lessons count as A1, after its words and before its sentences.
    expect(keys(slots)).toEqual(["word:5", "word:4", "phonics:6:pair-a:0", "sentence:1", "word:2", "word:3"]);
  });

  it("never plans anything for the human file", () => {
    const plan = planMachineAudio([word(1, "le chat", { humanPlays: true, machine: made(11, "le chat") })]);
    expect(plan.jobs).toEqual([]);
  });
});

describe("which voice reads each sentence", () => {
  it("alternates a text's speakers and gives a dialogue's other person the second voice", () => {
    const roles = sentenceRoles(
      [
        { id: 2, sentence_ids: [10, 11, 12, 13], speakers: ["Anne", "Marc", "Anne", "Léa"] },
        { id: 1, sentence_ids: [20, 21], speakers: null },
      ],
      [{ id: 1, turns: [{ sentence_id: 30, choices: [{ sentence_id: 31 }, { sentence_id: 32 }] }, { sentence_id: 10 }] }],
    );
    expect(Object.fromEntries(roles)).toEqual({ 10: 0, 11: 1, 12: 0, 13: 0, 30: 1, 31: 0, 32: 0 });
  });
});

describe("the voices", () => {
  it("has two voices per language, each with a credit and a known licence", () => {
    for (const language of ["fr", "de"] as const) {
      expect(machineVoices[language]).toHaveLength(2);
      expect(voiceFor(language, 0)?.language).toBe(language);
      expect(voiceFor(language, 1)?.language).toBe(language);
    }
    expect(new Set(allVoices.map((voice) => voice.id)).size).toBe(allVoices.length);
    for (const voice of allVoices) {
      expect(voiceLicences[voice.credit.licence]).toMatch(/^https:\/\/creativecommons\.org\//);
      expect(voiceById(voice.id)).toBe(voice);
    }
    expect(voiceFor("es", 0)).toBeNull();
  });

  it("ships every voice's model and settings in the repository", () => {
    for (const voice of allVoices) {
      const model = path.join("scripts/audio/voices", `${voice.model}.onnx`);
      expect(existsSync(model), model).toBe(true);
      const config = JSON.parse(readFileSync(`${model}.json`, "utf8")) as { language: { family: string }; speaker_id_map: Record<string, number> };
      expect(config.language.family).toBe(voice.language);
      if (voice.speaker !== null) expect(Object.values(config.speaker_id_map)).toContain(voice.speaker);
    }
    expect(JSON.parse(readFileSync("scripts/audio/voices/fr_FR-upmc-medium.onnx.json", "utf8")).speaker_id_map.pierre).toBe(1);
  });

  it("reads one line with spaces evened out, and nothing without a letter", () => {
    expect(spokenLine("  Il   fait\nbeau. ")).toBe("Il fait beau.");
    expect(spokenLine("Straße")).toBe("Straße");
    expect(spokenLine("— 12 !")).toBeNull();
    expect(spokenLine(null)).toBeNull();
  });
});

/** A 16-bit PCM WAV file, as Piper writes it. */
function wav(rate: number, channels: number[][]) {
  const frames = channels[0].length;
  const bytes = new Uint8Array(44 + frames * channels.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, value: string) => [...value].forEach((char, i) => (bytes[at + i] = char.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, frames * channels.length * 2, true);
  for (let frame = 0; frame < frames; frame++)
    channels.forEach((channel, index) => view.setInt16(44 + (frame * channels.length + index) * 2, Math.round(channel[frame] * 32767), true));
  return bytes;
}

const sine = (rate: number, hz: number, seconds: number, amplitude = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate));

describe("Piper's WAV files", () => {
  it("reads 16-bit PCM and mixes two channels to one", () => {
    const read = readWav(wav(22050, [[0.5, -0.5, 0.25], [0.5, 0.5, -0.25]]));
    expect(read.rate).toBe(22050);
    expect(Array.from(read.pcm).map((value) => Math.round(value * 100) / 100)).toEqual([0.5, 0, 0]);
  });

  it("refuses what is not a WAV of 16-bit PCM", () => {
    expect(() => readWav(new TextEncoder().encode("ID3 not a wav file"))).toThrow("Not a WAV file");
    const float = wav(22050, [[0.1]]);
    new DataView(float.buffer).setUint16(20, 3, true);
    expect(() => readWav(float)).toThrow("Unsupported WAV");
  });

  it("changes 22,050 Hz to the app's rate without changing the pitch or the loudness", () => {
    const input = sine(22050, 440, 1);
    const output = resample(input, 22050, 24000);
    expect(output.length).toBe(24000);
    // Count upward zero crossings in the steady middle: still 440 per second.
    const middle = output.subarray(2400, 21600);
    let crossings = 0;
    for (let i = 1; i < middle.length; i++) if (middle[i - 1] < 0 && middle[i] >= 0) crossings++;
    expect(Math.abs(crossings / 0.8 - 440)).toBeLessThan(3);
    const peak = middle.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.48);
    expect(peak).toBeLessThan(0.52);
    expect(resample(input, 22050, 22050)).toEqual(input);
  });

  it("drops what is above the new rate's limit instead of folding it back", () => {
    const output = resample(sine(48000, 15000, 0.5), 48000, 24000);
    const middle = output.subarray(1200, 10800);
    const peak = middle.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeLessThan(0.02);
  });
});
