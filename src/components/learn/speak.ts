"use client";

import { fileAtMs, playFile, speakText, stopPlaying, useDeviceVoice, usePlaying } from "@/components/admin/audio/player";
import type { Speak } from "@/engine/content";

/**
 * Sound in the learner app (PRD §3.5, §13.8): the stored file when there is one, else the phone's own
 * voice for the language. One sound at a time; «آهسته» plays it slower.
 */

/** Playback rates: a file, and the phone's voice, which reads a little slower than it speaks by default. */
export const RATE = { file: 1, fileSlow: 0.75, voice: 0.92, voiceSlow: 0.62 } as const;

/** Plays a sound; `onEnd` runs when it played to its end, not when something stopped it. */
export function say(id: string, speak: Speak, slow = false, onEnd?: () => void) {
  if (speak.url) playFile(id, speak.url, 0, undefined, slow ? RATE.fileSlow : RATE.file, onEnd);
  else speakText(id, speak.text, speak.lang, slow ? RATE.voiceSlow : RATE.voice, onEnd);
}

/** A sound that needs the phone's voice: no stored file. */
export const needsVoice = (speak: Speak | null | undefined) => !!speak && !speak.url;

export { fileAtMs, playFile, stopPlaying as hush, useDeviceVoice, usePlaying };
