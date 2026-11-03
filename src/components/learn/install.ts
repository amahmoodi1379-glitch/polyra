"use client";

import { useSyncExternalStore } from "react";

/**
 * Installing the app on the phone (PRD §3.11 row 7): Chrome's install window kept for «نصب», Safari's
 * two-step guide on an iPhone, and nothing when the app is already open from the home screen. The
 * service worker that keeps static files and session sound (PRD §15.6) is registered here too.
 */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export type InstallState = "standalone" | "prompt" | "ios" | "none";

let deferred: InstallEvent | null = null;
let installed = false;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => installed || window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function installState(): InstallState {
  if (typeof window === "undefined") return "none";
  if (standalone()) return "standalone";
  if (deferred) return "prompt";
  return isIos() ? "ios" : "none";
}

/** Once per page: keep Chrome's install event and register the service worker (production only). */
export function startPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
  if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

/** Chrome's install window: what the learner answered, or "unavailable" when Chrome has none to show. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  emit();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") installed = true;
    return choice.outcome;
  } catch {
    return "unavailable";
  } finally {
    emit();
  }
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    installState,
    () => "none",
  );
}

/** Every sound file a session's plan names, fetched ahead by the service worker (PRD §15.6). */
export function keepSessionSound(plan: unknown) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const urls = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (value.startsWith("/media/")) urls.add(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(plan);
  if (urls.size === 0) return;
  // Waits for the worker on a first visit; never settles where none is registered (development).
  void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "media", urls: [...urls] }));
}
