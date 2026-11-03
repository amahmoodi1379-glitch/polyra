import type { LibrarySlug } from "@/server/content/library/slugs";

/** The library list a report's item belongs to (PRD §13.10), by the item type a report carries. */
export const reportSlug: Record<string, LibrarySlug> = {
  word: "words",
  sentence: "sentences",
  grammar_unit: "units",
  conjugation: "tables",
  conjugation_table: "tables",
  transform_item: "transforms",
  translate_item: "translations",
  text: "texts",
  dialogue: "dialogues",
  errorfix_item: "errorfix",
  writing_task: "writing",
  phonics_lesson: "phonics",
};
