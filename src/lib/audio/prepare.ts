import { normalizeLoudness, trimSilence } from "./loudness";
import { encodeMp3, readMp3 } from "./mp3";
import { AUDIO_RATE } from "./standard";

/**
 * Speech in the app's format: the silent edges cut, the loudness evened out, written as mp3. The
 * panel runs it in the browser on every recording and uploaded file, so every stored file is made the
 * same way.
 */
export function prepareSpeech(pcm: Float32Array, rate = AUDIO_RATE) {
  if (rate !== AUDIO_RATE) throw new Error(`Speech must be at ${AUDIO_RATE} Hz, got ${rate}`);
  const mp3 = encodeMp3(normalizeLoudness(trimSilence(pcm, rate), rate));
  const info = readMp3(mp3);
  if (!info.ok) throw new Error(`Encoded audio is not readable (${info.reason})`);
  return { mp3, durationMs: info.durationMs };
}
