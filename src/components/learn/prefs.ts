"use client";

import { useSyncExternalStore } from "react";
import { PREFS_KEY } from "@/lib/theme-script";

/**
 * This device's preferences in the learner app: theme, interface sounds, haptics, and whether the
 * learner has started a session here (for the first-time hint under the jelly). They are kept in the
 * browser only; the session length lives on the account (PRD §3.1).
 */

export type Theme = "auto" | "light" | "dark";
export type Prefs = { theme: Theme; sound: boolean; haptics: boolean; started: boolean };

const defaults: Prefs = { theme: "auto", sound: true, haptics: true, started: false };

let current: Prefs | null = null;
const listeners = new Set<() => void>();

function read(): Prefs {
  if (current) return current;
  current = { ...defaults };
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    current = { ...defaults, ...stored };
  } catch {
    // Private windows and blocked storage: the defaults work.
  }
  return current;
}

export function applyTheme(theme: Theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export const prefs = {
  get: (): Prefs => (typeof window === "undefined" ? defaults : read()),
  set(change: Partial<Prefs>) {
    current = { ...read(), ...change };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(current));
    } catch {
      // Kept for this visit only.
    }
    if (change.theme) applyTheme(change.theme);
    listeners.forEach((listener) => listener());
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, prefs.get, () => defaults);
}

