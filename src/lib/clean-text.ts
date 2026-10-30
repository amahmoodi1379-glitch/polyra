/**
 * Text as it is saved, whoever wrote it (a chatbot answer, a panel form, a CSV file): one Unicode
 * form (NFC, PRD §5.6 step 1), the Persian ی and ک in place of the Arabic letters, no invisible
 * direction marks, soft hyphens or byte-order marks, and a plain space for every non-breaking or
 * wide one. The zero-width non-joiner (نیم‌فاصله) and line breaks stay.
 */
const ARABIC_YEH = /[يى]/g;
const ARABIC_KAF = /ك/g;
const INVISIBLE = /[­؜​‎‏‪-‮⁠⁦-⁩﻿]/g;
const SPACES = /[  -   　]/g;

export const cleanText = (text: string) =>
  text.normalize("NFC").replace(ARABIC_YEH, "ی").replace(ARABIC_KAF, "ک").replace(INVISIBLE, "").replace(SPACES, " ");

/** Every string inside a parsed answer or form, cleaned; everything else as it is. */
export function cleanDeep<T>(value: T): T {
  if (typeof value === "string") return cleanText(value) as T;
  if (Array.isArray(value)) return value.map(cleanDeep) as T;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)])) as T;
  }
  return value;
}
