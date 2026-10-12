/**
 * Step 2 of the four-step path (PRD §13.9): the admin pastes the chatbot's whole answer. This file
 * removes whatever surrounds the JSON (greetings, ``` fences, notes after it), notices an answer that
 * was cut off, and joins a cut answer with its continuation. Pure functions, no database.
 */

export type PasteResult =
  | { state: "ok"; value: unknown; text: string }
  /** Cut off: the admin writes «ادامه بده» in the chatbot and pastes the rest. */
  | { state: "cut"; text: string }
  /** Nothing that looks like the expected answer. */
  | { state: "empty" }
  /** Looks complete but is not valid; usually something was added or removed by hand. */
  | { state: "broken"; text: string };

/** Keeps only what is inside the first ``` fence, if the answer has one. */
function unfence(raw: string) {
  const fence = raw.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)(?:```|$)/);
  return fence ? fence[1] : raw;
}

/** Characters chat apps put in that break JSON: byte-order mark, zero-width spaces, non-breaking spaces. */
function tidy(raw: string) {
  return raw.replace(/^﻿/, "").replace(/[​⁠]/g, "").replace(/\r\n?/g, "\n");
}

type Scan = { end: number; depth: number; inString: boolean };

/** Walks JSON text from `start`, respecting strings, until the opening bracket closes. */
function scan(text: string, start: number): Scan {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return { end: i + 1, depth, inString };
    }
  }
  return { end: text.length, depth, inString };
}

/** Removes commas before a closing bracket, which chatbots sometimes leave and JSON forbids. */
function dropTrailingCommas(text: string) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      const rest = text.slice(i + 1).match(/^\s*([}\]])/);
      if (rest) continue;
    }
    out += ch;
  }
  return out;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(dropTrailingCommas(text)) };
  } catch {
    return { ok: false };
  }
}

/** The main key of an answer, or any of its parts' keys for an answer made of several parts. */
export type AnswerKeys = string | readonly string[];

function isAnswer(value: unknown, rootKey: AnswerKeys | undefined): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (rootKey) return (typeof rootKey === "string" ? [rootKey] : rootKey).some((key) => key in value);
  return Object.keys(value).length > 0;
}

/** Objects that carry the answer's own key anywhere between `from` and `to`, outermost first. */
function keyedObjects(text: string, from: number, to: number, rootKey: AnswerKeys) {
  const found: { value: unknown; text: string }[] = [];
  for (let start = text.indexOf("{", from); start >= 0 && start < to; start = text.indexOf("{", start + 1)) {
    const scanned = scan(text, start);
    if (scanned.depth > 0) continue;
    const body = text.slice(start, scanned.end);
    const parsed = tryParse(body);
    if (parsed.ok && isAnswer(parsed.value, rootKey)) {
      found.push({ value: parsed.value, text: body });
      start = scanned.end - 1;
    }
  }
  return found;
}

/**
 * Cleans one pasted answer. Every answer is one JSON object, so only the outermost objects in the
 * paste count; the records inside an answer are never mistaken for the answer itself. A "{" in the
 * chatbot's own words is skipped because it does not make a valid object. When the caller gives the
 * answer's main key (`words`, `items`, ...), objects without it are ignored, and an answer hidden
 * behind a stray "{" in the chatbot's words is still found.
 */
export function cleanPaste(raw: string, rootKey?: AnswerKeys): PasteResult {
  const text = unfence(tidy(raw));
  const answers: { value: unknown; text: string }[] = [];
  let cut: string | null = null;
  let broken: string | null = null;

  for (let start = text.indexOf("{"); start >= 0; ) {
    const scanned = scan(text, start);
    const body = text.slice(start, scanned.end);
    if (scanned.depth > 0) {
      // Never closes: either the answer was cut off, or a stray "{" before it.
      cut = body;
      if (rootKey) answers.push(...keyedObjects(text, start + 1, text.length, rootKey));
      break;
    }
    const parsed = tryParse(body);
    if (parsed.ok && isAnswer(parsed.value, rootKey)) answers.push({ value: parsed.value, text: body });
    else {
      broken ??= body;
      if (rootKey) answers.push(...keyedObjects(text, start + 1, scanned.end, rootKey));
    }
    start = text.indexOf("{", scanned.end);
  }

  const best = answers.reduce<(typeof answers)[number] | null>(
    (longest, answer) => (!longest || answer.text.length > longest.text.length ? answer : longest),
    null,
  );
  // Without the main key, a small complete object before a longer cut one is an example in the
  // chatbot's words, not the answer.
  if (best && (rootKey || !cut || best.text.length >= cut.length)) return { state: "ok", ...best };
  if (cut !== null) return { state: "cut", text: cut };
  if (broken !== null) return { state: "broken", text: broken };
  return { state: "empty" };
}

/**
 * Where the JSON of a continuation may be. A chatbot that goes on exactly where it stopped ends its
 * code block in the continuation, so the JSON is before the first ``` fence; one that opens a new code
 * block puts it inside the fence. Both are tried, and the whole text last.
 */
function continuationBodies(raw: string) {
  const text = tidy(raw);
  const fence = text.indexOf("```");
  const bodies = fence < 0 ? [text] : [text.slice(0, fence), unfence(text), text];
  return [...new Set(bodies.map((body) => body.trim()).filter(Boolean))];
}

/** Drops the last, unfinished element of a cut answer: back to the last "}" or "]" that closed one. */
function trimToLastComplete(text: string) {
  let inString = false;
  let lastClose = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "}" || ch === "]") lastClose = i;
  }
  return lastClose >= 0 ? text.slice(0, lastClose + 1) : text;
}

/** Longest end of `a` that is also the start of `b` (the chatbot repeated a bit), up to 4000 chars. */
function overlap(a: string, b: string) {
  for (let k = Math.min(a.length, b.length, 4000); k > 8; k--) {
    if (a.endsWith(b.slice(0, k))) return k;
  }
  return 0;
}

/**
 * Joins a cut answer with the continuation the admin pasted. Chatbots continue in different ways:
 * exactly where they stopped, repeating the last few characters, restarting the unfinished record,
 * or starting the whole answer again. Each way is tried and the first that makes complete JSON wins;
 * if the joined text is still cut, it is returned as cut so the admin can paste one more part.
 */
export function joinPaste(first: string, continuation: string, rootKey?: AnswerKeys): PasteResult {
  const head = first.trimEnd();
  const tails = continuationBodies(continuation);
  if (tails.length === 0) return { state: "cut", text: head };

  const trimmed = trimToLastComplete(head);
  const results: PasteResult[] = [];
  for (const tail of tails) {
    const tailStart = tail.search(/[{["]/);
    const tailFromJson = tailStart >= 0 ? tail.slice(tailStart) : tail;
    const candidates = [
      head + tail,
      head + tail.slice(overlap(head, tail)),
      trimmed + tailFromJson,
      `${trimmed},${tailFromJson}`,
      head + tailFromJson,
    ];
    for (const candidate of candidates) {
      const result = cleanPaste(candidate, rootKey);
      if (result.state === "ok") return result;
      results.push(result);
    }
  }
  const restarted = cleanPaste(continuation, rootKey);
  if (restarted.state === "ok") return restarted;

  // Still not complete: keep the longest join that is merely cut, for another «ادامه بده».
  const stillCut = results
    .filter((result): result is Extract<PasteResult, { state: "cut" }> => result.state === "cut")
    .reduce<Extract<PasteResult, { state: "cut" }> | null>((longest, result) => (!longest || result.text.length > longest.text.length ? result : longest), null);
  if (stillCut) return stillCut;
  return { state: "broken", text: head + tails[0] };
}
