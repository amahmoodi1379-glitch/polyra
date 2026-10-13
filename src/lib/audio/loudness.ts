import { EDGE_PAD_MS, PEAK_CEILING_DB, SILENCE_DB, TARGET_LUFS } from "./standard";

/**
 * Loudness of speech as ITU-R BS.1770 measures it (K-weighting, 400 ms blocks, absolute and relative
 * gates), so every file plays as loud as the one before it, whoever recorded it (PRD §13.8).
 */

type Biquad = { b: [number, number, number]; a: [number, number] };

/** RBJ coefficients of the two K-weighting stages for any sample rate (as pyloudnorm computes them). */
function kWeighting(rate: number): Biquad[] {
  const stage = (kind: "shelf" | "pass", gainDb: number, q: number, fc: number): Biquad => {
    const A = 10 ** (gainDb / 40);
    const w0 = (2 * Math.PI * fc) / rate;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    let b: [number, number, number];
    let a: [number, number, number];
    if (kind === "shelf") {
      const root = 2 * Math.sqrt(A) * alpha;
      b = [A * (A + 1 + (A - 1) * cos + root), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - root)];
      a = [A + 1 - (A - 1) * cos + root, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - root];
    } else {
      b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
      a = [1 + alpha, -2 * cos, 1 - alpha];
    }
    return { b: [b[0] / a[0], b[1] / a[0], b[2] / a[0]], a: [a[1] / a[0], a[2] / a[0]] };
  };
  return [stage("shelf", 4, 1 / Math.SQRT2, 1500), stage("pass", 0, 0.5, 38)];
}

function filter(input: Float32Array, { b, a }: Biquad) {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

const BLOCK_S = 0.4;
const STEP_S = 0.1;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
const toLufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);

/** Integrated loudness in LUFS; -Infinity for silence. A sound shorter than one block is one block. */
export function integratedLoudness(pcm: Float32Array, rate: number): number {
  if (pcm.length === 0) return -Infinity;
  const weighted = kWeighting(rate).reduce(filter, pcm);
  const block = Math.min(pcm.length, Math.round(BLOCK_S * rate));
  const step = Math.max(1, Math.round(STEP_S * rate));
  const squares: number[] = [];
  for (let start = 0; start + block <= weighted.length; start += step) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += weighted[i] * weighted[i];
    squares.push(sum / block);
  }
  const loud = squares.filter((z) => z > 0 && toLufs(z) > ABSOLUTE_GATE);
  if (loud.length === 0) return -Infinity;
  const relative = toLufs(loud.reduce((s, z) => s + z, 0) / loud.length) + RELATIVE_GATE;
  const kept = loud.filter((z) => toLufs(z) > relative);
  return toLufs(kept.reduce((s, z) => s + z, 0) / kept.length);
}

export const peakDb = (pcm: Float32Array) => {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
};

/** The sound brought to the target loudness, turned down further if its peaks would clip. */
export function normalizeLoudness(pcm: Float32Array, rate: number, target = TARGET_LUFS, ceiling = PEAK_CEILING_DB): Float32Array {
  const loudness = integratedLoudness(pcm, rate);
  if (!Number.isFinite(loudness)) return pcm.slice();
  const gainDb = Math.min(target - loudness, ceiling - peakDb(pcm));
  const gain = 10 ** (gainDb / 20);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain;
  return out;
}

/** Cuts the silence before and after the speech, keeping a short pad on each side. */
export function trimSilence(pcm: Float32Array, rate: number, pad = EDGE_PAD_MS, silenceDb = SILENCE_DB): Float32Array {
  const window = Math.max(1, Math.round(rate / 100));
  const threshold = (10 ** (silenceDb / 20)) ** 2;
  let first = -1;
  let last = -1;
  for (let start = 0; start < pcm.length; start += window) {
    const end = Math.min(pcm.length, start + window);
    let sum = 0;
    for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
    if (sum / (end - start) > threshold) {
      if (first < 0) first = start;
      last = end;
    }
  }
  if (first < 0) return pcm.slice();
  const keep = Math.round((pad / 1000) * rate);
  return pcm.slice(Math.max(0, first - keep), Math.min(pcm.length, last + keep));
}
