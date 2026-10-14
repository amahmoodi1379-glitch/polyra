/**
 * Persian text with French or German inside it, written by a chatbot (a unit title such as
 * «گذشته با avoir (فعل‌های -er)»). Each Latin run, with a hyphen or apostrophe it starts with, is
 * wrapped in a left-to-right isolate so "-er" does not show as "er-" and brackets stay in place.
 * Words joined by an ellipsis, a colon or "≠" stay one run ("nous: avons faits ≠ avons fait").
 */
const word = String.raw`[\p{Script=Latin}][\p{Script=Latin}\p{M}\p{Nd}_'’-]*`;
const gap = String.raw`(?:\s*(?:\.{3}|…|≠)\s*|:\s*|\s+)`;
const latinRun = new RegExp(String.raw`-?${word}(?:${gap}${word})*`, "gu");

export function isolateLatin(text: string) {
  return text.replace(latinRun, (run) => `\u2066${run}\u2069`);
}

/** The same runs as pieces, for a page that sets Latin words in their own typeface. */
export function splitLatin(text: string): { text: string; latin: boolean }[] {
  const parts: { text: string; latin: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(latinRun)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index), latin: false });
    parts.push({ text: match[0], latin: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), latin: false });
  return parts;
}
