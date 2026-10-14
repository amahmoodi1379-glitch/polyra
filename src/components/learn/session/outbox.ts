"use client";

import { useEffect, useSyncExternalStore } from "react";
import { reportError } from "@/lib/report-error";
import type { AnswerRequest, AnswerResponse } from "@/server/learn/answer";

/**
 * Answers waiting to reach the server (PRD §15.4). Each finished card is saved here first and sent
 * one at a time in order, so a lost connection loses nothing: the learner keeps going and the answers
 * leave when the connection is back, from any page of the app.
 */

const KEY = "polyra.outbox";

let items: AnswerRequest[] | null = null;

function load(): AnswerRequest[] {
  if (items) return items;
  try {
    items = JSON.parse(localStorage.getItem(KEY) ?? "[]") as AnswerRequest[];
  } catch {
    items = [];
  }
  return items;
}

function save(next: AnswerRequest[]) {
  items = next;
  try {
    if (next.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kept in memory for this visit.
  }
}

/** What the session screen hears back. */
export type OutboxHandlers = {
  /** The server's answer to one sent card (only for the session on screen). */
  onResult?: (sessionId: string, response: Extract<AnswerResponse, { kind: "ok" | "resync" | "gone" }>) => void;
};

let handlers: OutboxHandlers = {};
export const listenOutbox = (next: OutboxHandlers) => {
  handlers = next;
  return () => {
    if (handlers === next) handlers = {};
  };
};

// The connection state, for the «اتصال قطع است» bar.
let offline = false;
const listeners = new Set<() => void>();
const setOffline = (value: boolean) => {
  if (offline === value) return;
  offline = value;
  listeners.forEach((listener) => listener());
};
export function useOffline() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => offline,
    () => false,
  );
}

type Sent = AnswerResponse | { kind: "offline" } | { kind: "signed_out" } | { kind: "server" };

async function post(item: AnswerRequest): Promise<Sent> {
  try {
    const response = await fetch("/api/learn/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
    if (response.status === 401) return { kind: "signed_out" };
    if (response.status >= 500) return { kind: "server" };
    return (await response.json()) as AnswerResponse;
  } catch {
    return { kind: "offline" };
  }
}

let running: Promise<void> | null = null;
let retry: number | undefined;
let delay = 1000;
let serverFailures = 0;

/** Sends what is waiting, in order. Resolves when the outbox is empty or the connection is down. */
export function flush(): Promise<void> {
  if (running) return running;
  window.clearTimeout(retry);
  running = (async () => {
    for (;;) {
      const [item] = load();
      if (!item) break;
      const result = await post(item);
      if (result.kind === "offline" || (result.kind === "server" && ++serverFailures < 3)) {
        setOffline(result.kind === "offline");
        retry = window.setTimeout(() => void flush(), delay);
        delay = Math.min(delay * 2, 20_000);
        break;
      }
      setOffline(false);
      delay = 1000;
      if (result.kind === "signed_out") {
        window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        break;
      }
      serverFailures = 0;
      if (result.kind === "ok" || result.kind === "duplicate") {
        save(load().filter((other) => other.answerId !== item.answerId));
        if (result.kind === "ok") handlers.onResult?.(item.sessionId, result);
      } else if (result.kind === "resync" || result.kind === "gone") {
        // The server's copy wins: what was answered after this point is answered again.
        save(load().filter((other) => other.sessionId !== item.sessionId));
        handlers.onResult?.(item.sessionId, result);
      } else {
        // Refused or failed three times: dropped, so the answers after it can still go.
        reportError(new Error(`Answer ${item.seq} of session ${item.sessionId} was not accepted: ${result.kind}`));
        save(load().filter((other) => other.answerId !== item.answerId));
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export function send(item: AnswerRequest) {
  save([...load(), item]);
  void flush();
}

export const waiting = (sessionId?: string) => load().filter((item) => !sessionId || item.sessionId === sessionId).length;

/**
 * Sends anything left from an earlier visit, and again whenever the connection comes back. The bar
 * also follows the browser's own word on the connection, so it shows before the next answer fails.
 */
export function OutboxSync() {
  useEffect(() => {
    const online = () => {
      setOffline(false);
      void flush();
    };
    const lost = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", lost);
    if (!navigator.onLine) setOffline(true);
    if (waiting() > 0) void flush();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", lost);
    };
  }, []);
  return null;
}
