import { describe, expect, it } from "vitest";
import { integratedLoudness, normalizeLoudness, peakDb, trimSilence } from "@/lib/audio/loudness";
import { encodeMp3, joinMp3, readMp3 } from "@/lib/audio/mp3";
import { prepareSpeech } from "@/lib/audio/prepare";
import { AUDIO_RATE, EDGE_PAD_MS, PEAK_CEILING_DB, TARGET_LUFS, TEXT_GAP_MS } from "@/lib/audio/standard";
import { spokenWord } from "@/lib/spoken";
import { normalizeName } from "@/server/content/audio/match";

/** A tone of `ms` milliseconds at `amplitude`, with `silenceMs` of silence before and after it. */
function tone(ms: number, amplitude: number, silenceMs = 0) {
  const edge = Math.round((silenceMs / 1000) * AUDIO_RATE);
  const body = Math.round((ms / 1000) * AUDIO_RATE);
  const pcm = new Float32Array(edge * 2 + body);
  for (let i = 0; i < body; i++) pcm[edge + i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / AUDIO_RATE);
  return pcm;
}

describe("the app's mp3 format (PRD §13.8)", () => {
  it("writes mono mp3 that reads back with its length", () => {
    const info = readMp3(encodeMp3(tone(1000, 0.3)));
    expect(info.ok).toBe(true);
    if (info.ok) expect(Math.abs(info.durationMs - 1000)).toBeLessThan(80);
  });

  it("refuses what is not in the format", () => {
    expect(readMp3(new Uint8Array(2))).toEqual({ ok: false, reason: "empty" });
    expect(readMp3(new TextEncoder().encode("RIFF....WAVEfmt "))).toEqual({ ok: false, reason: "notMp3" });
    const cut = encodeMp3(tone(500, 0.3));
    expect(readMp3(cut.subarray(0, cut.length - 10))).toEqual({ ok: false, reason: "format" });
  });

  it("joins files with a pause and knows where each one starts", () => {
    const first = encodeMp3(tone(800, 0.3));
    const second = encodeMp3(tone(1200, 0.3));
    const joined = joinMp3([first, second]);
    const lengths = [first, second].map((bytes) => (readMp3(bytes) as { durationMs: number }).durationMs);
    expect(joined.offsetsMs[0]).toBe(0);
    // The pause is at least TEXT_GAP_MS; the encoder rounds it up to whole frames.
    expect(joined.offsetsMs[1]).toBeGreaterThanOrEqual(lengths[0] + TEXT_GAP_MS);
    expect(joined.offsetsMs[1]).toBeLessThan(lengths[0] + TEXT_GAP_MS + 100);
    expect(Math.abs(joined.durationMs - (joined.offsetsMs[1] + lengths[1]))).toBeLessThanOrEqual(1);
    expect(readMp3(joined.bytes)).toEqual(expect.objectContaining({ ok: true, durationMs: joined.durationMs }));
  });
});

describe("evening out speech (PRD §13.8)", () => {
  it("brings a quiet recording to the target loudness, under the peak ceiling", () => {
    const quiet = tone(2000, 0.02);
    const out = normalizeLoudness(quiet, AUDIO_RATE);
    expect(Math.abs(integratedLoudness(out, AUDIO_RATE) - TARGET_LUFS)).toBeLessThan(0.5);
    expect(peakDb(out)).toBeLessThanOrEqual(PEAK_CEILING_DB + 0.01);
  });

  it("cuts the silence around the speech and keeps a short pad", () => {
    const out = trimSilence(tone(1000, 0.3, 1500), AUDIO_RATE);
    const expected = ((1000 + 2 * EDGE_PAD_MS) / 1000) * AUDIO_RATE;
    expect(Math.abs(out.length - expected)).toBeLessThan(AUDIO_RATE / 50);
  });

  it("prepares a recording end to end", () => {
    const { mp3, durationMs } = prepareSpeech(tone(1000, 0.1, 1000));
    expect(readMp3(mp3).ok).toBe(true);
    expect(Math.abs(durationMs - (1000 + 2 * EDGE_PAD_MS))).toBeLessThan(100);
  });
});

describe("what a word's audio says (PRD §5.1)", () => {
  const word = (language: string, lemma: string, pos: string, gender: string | null, number: string | null = null) => ({ language, lemma, pos, gender, number });

  it("puts the article before a noun", () => {
    expect(spokenWord(word("fr", "voiture", "noun", "f"))).toBe("une voiture");
    expect(spokenWord(word("fr", "homme", "noun", "m"))).toBe("un homme");
    expect(spokenWord(word("fr", "gens", "noun", "m", "pl_only"))).toBe("des gens");
    expect(spokenWord(word("de", "Tisch", "noun", "der"))).toBe("der Tisch");
    expect(spokenWord(word("de", "Leute", "noun", null, "pl_only"))).toBe("die Leute");
  });

  it("leaves other words as they are", () => {
    expect(spokenWord(word("fr", "manger", "verb", null))).toBe("manger");
    expect(spokenWord(word("de", "schnell", "adj", null))).toBe("schnell");
    expect(spokenWord(word("fr", "eau", "noun", null))).toBe("eau");
  });
});

describe("file names in bulk upload (PRD §13.8)", () => {
  it("compares names without case, accents or punctuation", () => {
    expect(normalizeName("Bonjour, madame !")).toBe("bonjour madame");
    expect(normalizeName("Un petit café ?")).toBe("un petit cafe");
    expect(normalizeName("s'il vous plaît")).toBe("s il vous plait");
    expect(normalizeName("Die Straße")).toBe("die strasse");
    expect(normalizeName("  ...  ")).toBe("");
  });
});
