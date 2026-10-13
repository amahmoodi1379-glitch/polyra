/**
 * The content types of the panel's "همه محتوا" section (PRD §13.2), in the order the menu shows them.
 * Pure data, so client components can use it too.
 */
export const librarySlugs = [
  "words",
  "sentences",
  "units",
  "tables",
  "transforms",
  "translations",
  "texts",
  "dialogues",
  "errorfix",
  "writing",
  "phonics",
] as const;

export type LibrarySlug = (typeof librarySlugs)[number];

export const isLibrarySlug = (value: unknown): value is LibrarySlug => librarySlugs.includes(value as LibrarySlug);

/** The `admin_log.entity` of each type: its table name (PRD §4). */
export const entityOf: Record<LibrarySlug, string> = {
  words: "word",
  sentences: "sentence",
  units: "grammar_unit",
  tables: "conjugation_table",
  transforms: "transform_item",
  translations: "translate_item",
  texts: "text",
  dialogues: "dialogue",
  errorfix: "errorfix_item",
  writing: "writing_task",
  phonics: "phonics_lesson",
};

export const contentStatuses = ["draft", "needs_review", "approved", "published", "retired"] as const;
export type ContentStatusValue = (typeof contentStatuses)[number];

/** What an admin can do to items from the list or the edit page (PRD §13.2, §13.7). Publishing is in «انتشار». */
export const statusActions = ["approve", "draft", "suspend", "unsuspend", "retire"] as const;
export type StatusAction = (typeof statusActions)[number];

/** Types whose items have no level of their own and are not filtered by it. */
export const withoutLevel = new Set<LibrarySlug>(["phonics"]);
