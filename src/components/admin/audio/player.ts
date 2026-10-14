"use client";

import { useSyncExternalStore } from "react";

/**
 * One sound at a time across the panel: a stored file, a stretch of one (a sentence of a text), or the
 * phone's voice (speechSynthesis). Starting one stops whatever was playing.
 */

let audio: HTMLAudioElement | null = null;
let current: string | null = null;
let frame = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const voiceTag: Record<string, string> = { fr: "fr-FR", de: "de-DE" };

function finish(id: string) {
  if (current !== id) return;
  current = null;
  cancelAnimationFrame(frame);
  emit();
}

export function stopPlaying() {
  audio?.pause();
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  cancelAnimationFrame(frame);
  current = null;
  emit();
}

/** Plays a file, or the part of it from `fromMs` up to `untilMs`; `rate` below 1 is slower. */
export function playFile(id: string, url: string, fromMs = 0, untilMs?: number, rate = 1) {
  stopPlaying();
  audio ??= new Audio();
  const player = audio;
  player.defaultPlaybackRate = rate;
  player.playbackRate = rate;
  current = id;
  emit();
  player.onended = () => finish(id);
  player.onerror = () => finish(id);
  const start = () => {
    player.currentTime = fromMs / 1000;
    player.play().catch(() => finish(id));
    if (untilMs === undefined) return;
    const watch = () => {
      if (current !== id) return;
      if (player.currentTime * 1000 >= untilMs) {
        player.pause();
        finish(id);
      } else frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
  };
  if (player.src.endsWith(url) && player.readyState >= 1) start();
  else {
    player.src = url;
    player.onloadedmetadata = start;
  }
}

/** Reads a text with the device's own voice for the language, as the app does when there is no file. */
export function speakText(id: string, text: string, language: string, rate = 1) {
  stopPlaying();
  if (typeof speechSynthesis === "undefined") return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceTag[language] ?? language;
  utterance.rate = rate;
  const voice = speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(language));
  if (voice) utterance.voice = voice;
  utterance.onend = () => finish(id);
  utterance.onerror = () => finish(id);
  current = id;
  emit();
  speechSynthesis.speak(utterance);
}

/** Whether the sound with this id is playing now. */
export function usePlaying(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => current === id,
    () => false,
  );
}

let voicesSettled = false;
function subscribeVoices(listener: () => void) {
  if (typeof speechSynthesis === "undefined") return () => {};
  speechSynthesis.addEventListener("voiceschanged", listener);
  // Some browsers never announce their voices when they have none at all.
  const timer = window.setTimeout(() => {
    voicesSettled = true;
    listener();
  }, 1500);
  return () => {
    speechSynthesis.removeEventListener("voiceschanged", listener);
    window.clearTimeout(timer);
  };
}

/** Whether this browser has a voice for the language; null until the browser has listed its voices. */
export function useDeviceVoice(language: string) {
  return useSyncExternalStore(
    subscribeVoices,
    () => {
      if (typeof speechSynthesis === "undefined") return false;
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0 && !voicesSettled) return null;
      return voices.some((voice) => voice.lang.toLowerCase().startsWith(language));
    },
    () => null,
  );
}
