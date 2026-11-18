/**
 * How many records the teacher may ask for in one batch on «ساخت محتوا» (owner's choice: the number of
 * each batch is theirs; DECISIONS.md). The default comes from «تنظیمات عمومی» (`batch.sizes`); a bigger
 * batch means a longer chatbot answer, which «ادامه بده» completes.
 */
export const batchSizeLimits = {
  "word-list": 1000,
  words: 200,
  sentences: 50,
  conjugation: 100,
  texts: 5,
  errorfix: 30,
  writing: 30,
} as const;

export type SizedKind = keyof typeof batchSizeLimits;

export const isSizedKind = (slug: string): slug is SizedKind => slug in batchSizeLimits;

/** A size from the form, or undefined when it is not a whole number in range. */
export function chosenSize(slug: string, raw: unknown): number | undefined {
  if (!isSizedKind(slug)) return undefined;
  const size = Number(String(raw ?? "").replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))));
  return Number.isInteger(size) && size >= 1 && size <= batchSizeLimits[slug] ? size : undefined;
}
