/** What prompts need to know about each language (PRD §14.1, §14.5). */
export const languageInfo = {
  fr: { name_fa: "فرانسوی", exam: "DELF/DALF", genders: ["m", "f", "mf"] },
  de: { name_fa: "آلمانی", exam: "Goethe", genders: ["der", "die", "das"] },
} as const;

export type LanguageCode = keyof typeof languageInfo;
export const languageCodes = Object.keys(languageInfo) as LanguageCode[];

export function isLanguage(value: string): value is LanguageCode {
  return value in languageInfo;
}

export const levelOrder = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** A1 < A2 < B1 ...; unknown levels sort last. */
export function levelRank(level: string | null | undefined) {
  const index = levelOrder.indexOf(level as (typeof levelOrder)[number]);
  return index < 0 ? levelOrder.length : index;
}
