"use client";

import { playFile, speakText, stopPlaying, useDeviceVoice, usePlaying } from "@/components/admin/audio/player";
import type { Speak } from "@/engine/content";

/**
 * Sound in the learner app (PRD §3.5, §13.8): the stored file when there is one, else the phone's own
 * voice for the language. One sound at a time; «آهسته» plays it slower.
 */

export function say(id: string, speak: Speak, slow = false) {
  if (speak.url) playFile(id, speak.url, 0, undefined, slow ? 0.75 : 1);
  else speakText(id, speak.text, speak.lang, slow ? 0.62 : 0.92);
}

/** A sound that needs the phone's voice: no stored file. */
export const needsVoice = (speak: Speak | null | undefined) => !!speak && !speak.url;

export { stopPlaying as hush, useDeviceVoice, usePlaying };
