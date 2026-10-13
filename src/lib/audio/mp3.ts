import { Mp3Encoder } from "@breezystack/lamejs";
import { AUDIO_KBPS, AUDIO_RATE, FRAME_SAMPLES, TEXT_GAP_MS } from "./standard";

/**
 * Writing and reading the app's mp3 format (standard.ts). Reading only walks the frame headers: it
 * checks a file is in the format and counts its frames, which gives its exact length. Joining files
 * of this format is putting their frames one after another.
 */

const FRAME_MS = (FRAME_SAMPLES / AUDIO_RATE) * 1000;
const CHUNK = FRAME_SAMPLES * 2;

/** Mono samples at AUDIO_RATE, between -1 and 1, as an mp3 file. */
export function encodeMp3(pcm: Float32Array): Uint8Array {
  const encoder = new Mp3Encoder(1, AUDIO_RATE, AUDIO_KBPS);
  const ints = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    ints[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const parts: Uint8Array[] = [];
  for (let start = 0; start < ints.length; start += CHUNK) parts.push(encoder.encodeBuffer(ints.subarray(start, start + CHUNK)));
  parts.push(encoder.flush());
  return join(parts);
}

function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** MPEG-2 Layer III bit rates (kbit/s) and sample rates, by header index. */
const BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES = [22050, 24000, 16000, 0];

export type Mp3Info = { ok: true; frames: number; durationMs: number } | { ok: false; reason: "empty" | "notMp3" | "format" };

/** Whether bytes are an mp3 in the app's format, and how long it is. */
export function readMp3(bytes: Uint8Array): Mp3Info {
  if (bytes.length < 4) return { ok: false, reason: "empty" };
  let position = 0;
  let frames = 0;
  while (position + 4 <= bytes.length) {
    const header = ((bytes[position] << 24) | (bytes[position + 1] << 16) | (bytes[position + 2] << 8) | bytes[position + 3]) >>> 0;
    if (header >>> 21 !== 0x7ff) return { ok: false, reason: frames === 0 ? "notMp3" : "format" };
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrate = BITRATES[(header >>> 12) & 15];
    const rate = RATES[(header >>> 10) & 3];
    const padding = (header >>> 9) & 1;
    const mono = ((header >>> 6) & 3) === 3;
    // MPEG-2 (version bits 10), Layer III (01), mono, the app's rate and bit rate.
    if (version !== 2 || layer !== 1 || rate !== AUDIO_RATE || bitrate !== AUDIO_KBPS || !mono) return { ok: false, reason: frames === 0 ? "notMp3" : "format" };
    position += Math.floor((72 * bitrate * 1000) / rate) + padding;
    frames++;
  }
  if (position !== bytes.length) return { ok: false, reason: "format" };
  return { ok: true, frames, durationMs: Math.round(frames * FRAME_MS) };
}

let gapCache: { ms: number; bytes: Uint8Array } | null = null;
function silence(ms: number) {
  if (gapCache?.ms !== ms) gapCache = { ms, bytes: encodeMp3(new Float32Array(Math.round((ms / 1000) * AUDIO_RATE))) };
  return gapCache.bytes;
}

export type Joined = { bytes: Uint8Array; offsetsMs: number[]; durationMs: number };

/**
 * One file from several, with a short silence between them, and where each one starts (PRD §13.8:
 * a text's file from its sentences, with `sentence_offsets_ms`). Every part must be in the app's format.
 */
export function joinMp3(parts: Uint8Array[], gapMs = TEXT_GAP_MS): Joined {
  const gap = silence(gapMs);
  const gapFrames = (readMp3(gap) as { frames: number }).frames;
  const pieces: Uint8Array[] = [];
  const offsetsMs: number[] = [];
  let frames = 0;
  parts.forEach((part, index) => {
    const info = readMp3(part);
    if (!info.ok) throw new Error(`Part ${index + 1} is not in the app's mp3 format (${info.reason})`);
    if (index > 0) {
      pieces.push(gap);
      frames += gapFrames;
    }
    offsetsMs.push(Math.round(frames * FRAME_MS));
    pieces.push(part);
    frames += info.frames;
  });
  return { bytes: join(pieces), offsetsMs, durationMs: Math.round(frames * FRAME_MS) };
}
