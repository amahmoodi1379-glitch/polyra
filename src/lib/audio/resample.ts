/**
 * Changing the sample rate of mono speech (Piper speaks at 22,050 Hz, the app's files are at
 * AUDIO_RATE): band-limited interpolation with a Blackman-windowed sinc. The cut-off sits a little
 * under the lower of the two Nyquist frequencies, so nothing folds back.
 */

const TAPS = 24;
const ROLL_OFF = 0.95;

export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  if (!(from > 0 && to > 0)) throw new Error(`Bad sample rates ${from} → ${to}`);
  const ratio = to / from;
  const length = Math.round(input.length * ratio);
  const out = new Float32Array(length);
  // Cut-off in cycles per input sample (0.5 is the input's Nyquist).
  const cutoff = 0.5 * Math.min(1, ratio) * ROLL_OFF;
  const width = Math.ceil(TAPS / Math.min(1, ratio));
  for (let n = 0; n < length; n++) {
    const center = n / ratio;
    const first = Math.max(0, Math.floor(center) - width + 1);
    const last = Math.min(input.length - 1, Math.floor(center) + width);
    let sum = 0;
    for (let k = first; k <= last; k++) {
      const x = center - k;
      const phase = 2 * cutoff * x;
      const sinc = phase === 0 ? 1 : Math.sin(Math.PI * phase) / (Math.PI * phase);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / width) + 0.08 * Math.cos((2 * Math.PI * x) / width);
      sum += input[k] * 2 * cutoff * sinc * w;
    }
    out[n] = sum;
  }
  return out;
}
