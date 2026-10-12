/**
 * Persian text with French or German inside it, written by a chatbot (a unit title such as
 * «گذشته با avoir (فعل‌های -er)»). Each Latin run, with a hyphen or apostrophe it starts with, is
 * wrapped in a left-to-right isolate so "-er" does not show as "er-" and brackets stay in place.
 */
const word = String.raw`[\p{Script=Latin}][\p{Script=Latin}\p{M}\p{Nd}'’-]*`;
const gap = String.raw`(?:\s*(?:\.{3}|…)\s*|\s+)`;
const latinRun = new RegExp(String.raw`-?${word}(?:${gap}${word})*`, "gu");

export function isolateLatin(text: string) {
  return text.replace(latinRun, (run) => `\u2066${run}\u2069`);
}
