/**
 * Cleaning typed answers before they are compared (PRD §5.6, "تمیزکاری قبل از مقایسه"). The same
 * steps run on the learner's answer and on every accepted answer.
 */

export type Lang = "fr" | "de";

const APOSTROPHES = /[’‘ʼ`´]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;
const ARABIC_DIGITS = /[٠-٩]/g;
/** Punctuation dropped from multi-word answers. Apostrophes and hyphens inside words stay. */
const SENTENCE_PUNCT = /[.,;:!?«»"()“”„‹›¿¡…]/g;
const END_PUNCT = /[.!?…]+$/;

/** True when the text has even one Persian or Arabic letter (PRD §3.5, the keyboard message). */
export const hasPersianLetter = (text: string): boolean => /(?=\p{Script=Arabic})\p{L}/u.test(text);

export const toLatinDigits = (text: string) =>
  text.replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));

/** Steps 1, 2 and 5 of §5.6 plus the punctuation rule for one word or for several. */
export function cleanAnswer(text: string, multi: boolean): string {
  let out = toLatinDigits(text.normalize("NFC")).replace(APOSTROPHES, "'");
  if (multi) out = out.replace(SENTENCE_PUNCT, " ");
  out = out.replace(/\s+/g, " ").trim();
  if (!multi) out = out.replace(END_PUNCT, "").trim();
  // A space after an elided article or pronoun is the same answer: «l' école» = «l'école».
  out = out.replace(/' /g, "'");
  return out;
}

/** An answer of more than one word uses the sentence rules (PRD §5.6 step 4). */
export const isMultiWord = (text: string) => cleanAnswer(text, true).includes(" ");

const ARTICLES: Record<Lang, RegExp> = {
  fr: /^(?:(?:un|une|le|la|les|des)\s+|l')/i,
  de: /^(?:der|die|das|ein|eine)\s+/i,
};

/** A noun typed with its article is compared without it (PRD §5.6 step 8). */
export const stripArticle = (text: string, lang: Lang) => text.replace(ARTICLES[lang], "");

const stripMarks = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
const ligatures = (text: string) => text.replace(/ß/g, "ss").replace(/ẞ/g, "SS").replace(/œ/g, "oe").replace(/Œ/g, "Oe").replace(/æ/g, "ae").replace(/Æ/g, "Ae");

/**
 * Two ways of writing a letter without its accent, both "almost right" (PRD §5.6): dropping the mark
 * (`uber` for `über`) and spelling the umlaut out (`ueber`). ß, œ and æ are always spelled out.
 */
export function folds(text: string): [string, string] {
  const spelled = ligatures(text).replace(/[äÄöÖüÜ]/g, (c) => ({ ä: "ae", Ä: "Ae", ö: "oe", Ö: "Oe", ü: "ue", Ü: "Ue" })[c] ?? c);
  return [stripMarks(ligatures(text)), stripMarks(spelled)];
}

const lowerFirst = (text: string) => (text ? text[0].toLowerCase() + text.slice(1) : text);

export type TextMatch = { result: "correct" } | { result: "near"; reason: "accent" | "case" } | { result: "wrong" };

/**
 * Compares one cleaned answer with one cleaned accepted answer (PRD §5.6, the result table).
 * French ignores case. German ignores the case of a sentence's first letter; any other case
 * difference is "near".
 */
export function matchText(given: string, accepted: string, lang: Lang, sentence: boolean): TextMatch {
  let a = given;
  let b = accepted;
  if (lang === "fr") {
    a = a.toLowerCase();
    b = b.toLowerCase();
  } else if (sentence) {
    a = lowerFirst(a);
    b = lowerFirst(b);
  }
  if (a === b) return { result: "correct" };
  if (lang === "de" && a.toLowerCase() === b.toLowerCase()) return { result: "near", reason: "case" };
  const same = (x: string, y: string) => x === y || (lang === "de" && x.toLowerCase() === y.toLowerCase());
  const [a1, a2] = folds(a);
  const [b1, b2] = folds(b);
  if (same(a1, b1) || same(a2, b2) || same(a1, b2) || same(a2, b1)) return { result: "near", reason: "accent" };
  return { result: "wrong" };
}

/** The best match against a list of accepted answers: correct beats near beats wrong. */
export function matchAny(given: string, accepted: readonly string[], lang: Lang, sentence: boolean): TextMatch {
  let best: TextMatch = { result: "wrong" };
  for (const item of accepted) {
    const match = matchText(given, item, lang, sentence);
    if (match.result === "correct") return match;
    if (match.result === "near" && best.result === "wrong") best = match;
  }
  return best;
}

/** Edit distance of at most one letter: one missing, extra, changed, or two neighbours swapped. */
export function oneLetterOff(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

/** Splits a cleaned multi-word answer into words. */
export const words = (text: string) => text.split(" ").filter(Boolean);
