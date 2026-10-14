"use client";

import { prefs } from "./prefs";

/**
 * Interface sounds and haptics of the learner app (DESIGN.md, «Do give every touch a response»).
 * The sounds are synthesized with Web Audio, no files: the recipes are those of the cuelume build (MIT,
 * Daniel Belyi) inside the approved prototype `design/prototypes/polyra-jelly.html`. Both follow the settings.
 */

type Tone = { kind: "tone"; waveform: OscillatorType; frequency: number; glideTo?: number; glideTime?: number; detune?: number; offset?: number; attack: number; decay: number; peak: number };
type Noise = { kind: "noise"; filterType: BiquadFilterType; filterFrequency: number; filterQ?: number; offset?: number; attack: number; decay: number; peak: number };
type Shimmer = { delay: number; feedback: number; wet: number; lowpass: number };
type Recipe = { masterGain: number; layers: (Tone | Noise)[]; shimmer?: Shimmer };

const sine = (frequency: number, attack: number, decay: number, peak: number, extra: Partial<Tone> = {}): Tone => ({ kind: "tone", waveform: "sine", frequency, attack, decay, peak, ...extra });
const noise = (filterType: BiquadFilterType, filterFrequency: number, filterQ: number, attack: number, decay: number, peak: number, offset?: number): Noise => ({
  kind: "noise",
  filterType,
  filterFrequency,
  filterQ,
  attack,
  decay,
  peak,
  offset,
});

const recipes = {
  droplet: { masterGain: 0.55, layers: [sine(1200, 0.004, 0.2, 0.075, { glideTo: 550, glideTime: 0.14 })], shimmer: { delay: 0.09, feedback: 0.2, wet: 0.15, lowpass: 3000 } },
  bloom: {
    masterGain: 0.5,
    layers: [sine(528, 0.06, 0.32, 0.06), sine(528, 0.06, 0.34, 0.05, { detune: 12 })],
    shimmer: { delay: 0.15, feedback: 0.2, wet: 0.12, lowpass: 2500 },
  },
  press: { masterGain: 0.4, layers: [noise("bandpass", 1700, 1.4, 0.001, 0.02, 0.13)] },
  release: { masterGain: 0.4, layers: [noise("bandpass", 4600, 1.8, 0.001, 0.016, 0.12), sine(3200, 0.001, 0.05, 0.02, { offset: 0.006 })] },
  toggle: { masterGain: 0.4, layers: [noise("bandpass", 2200, 1.6, 0.001, 0.016, 0.12), noise("bandpass", 3800, 1.6, 0.001, 0.02, 0.1, 0.024)] },
  tick: { masterGain: 0.4, layers: [noise("bandpass", 5400, 1.8, 0.001, 0.018, 0.14), sine(2600, 0.001, 0.012, 0.018)] },
  success: {
    masterGain: 0.5,
    layers: [sine(880, 0.004, 0.09, 0.06), sine(1108.73, 0.004, 0.1, 0.06, { offset: 0.06 }), sine(1318.51, 0.004, 0.18, 0.07, { offset: 0.12 })],
    shimmer: { delay: 0.1, feedback: 0.22, wet: 0.16, lowpass: 4500 },
  },
  error: {
    masterGain: 0.42,
    layers: [
      noise("bandpass", 850, 1.1, 0.001, 0.035, 0.13),
      { kind: "tone", waveform: "triangle", frequency: 440, offset: 0.025, attack: 0.004, decay: 0.09, peak: 0.045 },
      { kind: "tone", waveform: "triangle", frequency: 349.23, offset: 0.1, attack: 0.004, decay: 0.14, peak: 0.04 },
    ],
  },
  page: {
    masterGain: 0.38,
    layers: [noise("lowpass", 1800, 0.7, 0.006, 0.08, 0.11), noise("bandpass", 4200, 1.2, 0.004, 0.065, 0.08, 0.04), sine(2400, 0.002, 0.045, 0.02, { offset: 0.075 })],
  },
  ready: {
    masterGain: 0.48,
    layers: [
      noise("bandpass", 3600, 1.8, 0.001, 0.02, 0.11),
      { kind: "tone", waveform: "triangle", frequency: 330, glideTo: 660, glideTime: 0.12, offset: 0.012, attack: 0.004, decay: 0.16, peak: 0.055 },
      sine(990, 0.004, 0.22, 0.06, { offset: 0.13 }),
    ],
    shimmer: { delay: 0.1, feedback: 0.16, wet: 0.1, lowpass: 4200 },
  },
  arrival: {
    masterGain: 0.44,
    layers: [
      noise("lowpass", 900, 0.8, 0.05, 0.24, 0.035),
      sine(220, 0.04, 0.34, 0.055, { glideTo: 440, glideTime: 0.32 }),
      sine(659.25, 0.045, 0.32, 0.04, { offset: 0.12 }),
      sine(987.77, 0.045, 0.34, 0.032, { offset: 0.19 }),
    ],
    shimmer: { delay: 0.16, feedback: 0.28, wet: 0.18, lowpass: 3200 },
  },
} satisfies Record<string, Recipe>;

export type SoundName = keyof typeof recipes;

const TAIL = 0.05;
const MIN_GAIN = 0.0001;
const OUTPUT_GAIN = 4;

let context: AudioContext | null = null;
let output: GainNode | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

function bus(ctx: AudioContext): GainNode {
  if (output) return output;
  const gain = ctx.createGain();
  gain.gain.value = OUTPUT_GAIN;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  gain.connect(limiter).connect(ctx.destination);
  output = gain;
  return gain;
}

function envelope(ctx: AudioContext, layer: Tone | Noise, at: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(MIN_GAIN, at);
  gain.gain.exponentialRampToValueAtTime(layer.peak, at + layer.attack);
  gain.gain.exponentialRampToValueAtTime(MIN_GAIN, at + layer.attack + layer.decay);
  return gain;
}

function tone(ctx: AudioContext, into: AudioNode, layer: Tone, at: number) {
  const osc = ctx.createOscillator();
  osc.type = layer.waveform;
  osc.frequency.setValueAtTime(layer.frequency, at);
  if (layer.detune) osc.detune.value = layer.detune;
  if (layer.glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(layer.glideTo, at + (layer.glideTime ?? layer.attack + layer.decay));
  osc.connect(envelope(ctx, layer, at)).connect(into);
  osc.start(at);
  osc.stop(at + layer.attack + layer.decay + TAIL);
}

function hiss(ctx: AudioContext, into: AudioNode, layer: Noise, at: number) {
  const length = layer.attack + layer.decay + TAIL;
  const frames = Math.max(1, Math.floor(length * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = layer.filterType;
  filter.frequency.value = layer.filterFrequency;
  if (layer.filterQ !== undefined) filter.Q.value = layer.filterQ;
  source.connect(filter).connect(envelope(ctx, layer, at)).connect(into);
  source.start(at);
  source.stop(at + length);
}

function render(ctx: AudioContext, recipe: Recipe, volume: number) {
  const now = ctx.currentTime;
  const out = bus(ctx);
  const master = ctx.createGain();
  master.gain.value = recipe.masterGain * volume;
  master.connect(out);
  const extra: AudioNode[] = [];
  if (recipe.shimmer) {
    const { delay: time, feedback, wet, lowpass } = recipe.shimmer;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = time;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    const loop = ctx.createGain();
    loop.gain.value = feedback;
    const mix = ctx.createGain();
    mix.gain.value = wet;
    master.connect(delay);
    delay.connect(filter).connect(loop).connect(delay);
    filter.connect(mix).connect(out);
    extra.push(delay, filter, loop, mix);
  }
  for (const layer of recipe.layers) {
    const at = now + (layer.offset ?? 0);
    if (layer.kind === "tone") tone(ctx, master, layer, at);
    else hiss(ctx, master, layer, at);
  }
  const length = Math.max(...recipe.layers.map((layer) => (layer.offset ?? 0) + layer.attack + layer.decay + TAIL));
  const echo = recipe.shimmer && recipe.shimmer.feedback > 0 ? recipe.shimmer.delay * (1 + Math.ceil(Math.log(0.001) / Math.log(recipe.shimmer.feedback))) : 0;
  window.setTimeout(
    () => {
      master.disconnect();
      for (const node of extra) node.disconnect();
    },
    (length + echo + TAIL) * 1000,
  );
}

/** Plays an interface sound, when sounds are on in the settings. */
export function sfx(name: SoundName, volume = 0.55) {
  if (!prefs.get().sound) return;
  if (typeof navigator !== "undefined" && navigator.userActivation?.hasBeenActive === false) return;
  const ctx = audioContext();
  if (!ctx) return;
  const recipe: Recipe = recipes[name];
  try {
    if (ctx.state === "running") render(ctx, recipe, volume);
    else void ctx.resume().then(() => ctx.state === "running" && render(ctx, recipe, volume), () => {});
  } catch {
    // Sound is a nicety; never let it break a tap.
  }
}

/** A short vibration, when haptics are on (Android browsers only). */
export function buzz(pattern: number | number[]) {
  if (!prefs.get().haptics || typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers refuse without a gesture.
  }
}
