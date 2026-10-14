import { toCsv, type CsvCell } from "@/lib/csv";
import { db } from "@/server/db";
import { levelRank, type LanguageCode } from "../languages";
import { librarySlugs, type LibrarySlug } from "../library/slugs";

/**
 * «خروجی» (PRD §13.2): every list of «همه محتوا» as a file, for review outside the panel or as a
 * backup. JSON keeps each item whole with its child rows (a sentence's word mapping and targets, a
 * text's questions and sentences); CSV is one row per item with its own columns only. The word CSV
 * has exactly the columns of PRD §14.7, so a list edited in a spreadsheet can come back in.
 */

export const wordCsvColumns = ["code", "lemma", "pos", "gender", "number", "plural", "meaning_fa", "level", "register", "concept_fa", "no_card", "homophones", "note_fa"] as const;

type Item = Record<string, unknown>;

const byLevelThen = (key: string) => (a: Item, b: Item) =>
  levelRank(a.level as string | null) - levelRank(b.level as string | null) ||
  ((a[key] as number | null) ?? Number.MAX_SAFE_INTEGER) - ((b[key] as number | null) ?? Number.MAX_SAFE_INTEGER) ||
  (a.id as number) - (b.id as number);

/** Sentences by id, with only what a reader needs next to a text or a dialogue. */
async function sentencesById(ids: number[]) {
  const rows = await db.sentence.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, text: true, translation_fa: true } });
  return new Map(rows.map((row) => [row.id, row]));
}

function dialogueSentenceIds(turns: unknown): number[] {
  if (!Array.isArray(turns)) return [];
  return turns.flatMap((turn: { sentence_id?: number; choices?: { sentence_id?: number }[] }) => [
    ...(turn.sentence_id ? [turn.sentence_id] : []),
    ...(turn.choices ?? []).map((choice) => choice.sentence_id).filter((id): id is number => typeof id === "number"),
  ]);
}

/** Every item of one type in one language, retired ones too, in the order the panel shows them. */
export async function exportItems(slug: LibrarySlug, language: LanguageCode): Promise<Item[]> {
  const where = { language };
  switch (slug) {
    case "words": {
      const rows = await db.word.findMany({ where, include: { concept: { select: { name_fa: true } } } });
      return rows.map(({ concept, ...word }) => ({ ...word, concept_fa: concept?.name_fa ?? null })).sort(byLevelThen("intro_order"));
    }
    case "sentences": {
      const rows = await db.sentence.findMany({
        where,
        orderBy: { id: "asc" },
        include: {
          words: { orderBy: { position: "asc" }, include: { word: { select: { code: true } } } },
          targets: { orderBy: { id: "asc" } },
        },
      });
      return rows.map(({ words, ...sentence }) => ({ ...sentence, words: words.map(({ word, ...row }) => ({ ...row, word_code: word?.code ?? null })) })).sort(byLevelThen("id"));
    }
    case "units":
      return (await db.grammarUnit.findMany({ where })).sort(byLevelThen("order_no"));
    case "tables": {
      const rows = await db.conjugationTable.findMany({ where, orderBy: { id: "asc" }, include: { word: { select: { code: true, lemma: true, level: true } } } });
      return rows.map(({ word, ...table }) => ({ ...table, verb_code: word.code, verb: word.lemma, level: word.level })).sort(byLevelThen("id"));
    }
    case "transforms": {
      const rows = await db.transformItem.findMany({ where, orderBy: { id: "asc" }, include: { grammar_unit: { select: { unit_code: true, level: true } } } });
      return rows.map(({ grammar_unit, ...item }) => ({ ...item, unit_code: grammar_unit.unit_code, level: grammar_unit.level })).sort(byLevelThen("id"));
    }
    case "translations": {
      const rows = await db.translateItem.findMany({ where, orderBy: { id: "asc" }, include: { grammar_unit: { select: { unit_code: true, level: true } } } });
      return rows.map(({ grammar_unit, ...item }) => ({ ...item, unit_code: grammar_unit.unit_code, level: grammar_unit.level })).sort(byLevelThen("id"));
    }
    case "texts": {
      const rows = await db.text.findMany({ where, include: { questions: { orderBy: [{ track: "asc" }, { set: "asc" }, { order_no: "asc" }] } } });
      const sentences = await sentencesById(rows.flatMap((row) => row.sentence_ids));
      return rows
        .map((text) => ({ ...text, sentences: text.sentence_ids.map((id) => sentences.get(id) ?? { id, text: null, translation_fa: null }) }))
        .sort(byLevelThen("order_override"));
    }
    case "dialogues": {
      const rows = await db.dialogue.findMany({ where, orderBy: { id: "asc" } });
      const sentences = await sentencesById(rows.flatMap((row) => dialogueSentenceIds(row.turns)));
      return rows
        .map((dialogue) => ({
          ...dialogue,
          sentences: [...new Set(dialogueSentenceIds(dialogue.turns))].map((id) => sentences.get(id) ?? { id, text: null, translation_fa: null }),
        }))
        .sort(byLevelThen("id"));
    }
    case "errorfix":
      return (await db.errorfixItem.findMany({ where, orderBy: { id: "asc" } })).sort(byLevelThen("id"));
    case "writing":
      return (await db.writingTask.findMany({ where, orderBy: { id: "asc" } })).sort(byLevelThen("id"));
    case "phonics":
      return db.phonicsLesson.findMany({ where, orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }] });
  }
}

/** How many items each type has in a language, retired ones too (what a file of it holds). */
export async function exportCounts(language: LanguageCode): Promise<Record<LibrarySlug, number>> {
  const where = { language };
  const counts = await Promise.all([
    db.word.count({ where }),
    db.sentence.count({ where }),
    db.grammarUnit.count({ where }),
    db.conjugationTable.count({ where }),
    db.transformItem.count({ where }),
    db.translateItem.count({ where }),
    db.text.count({ where }),
    db.dialogue.count({ where }),
    db.errorfixItem.count({ where }),
    db.writingTask.count({ where }),
    db.phonicsLesson.count({ where }),
  ]);
  return Object.fromEntries(librarySlugs.map((slug, index) => [slug, counts[index]])) as Record<LibrarySlug, number>;
}

/** A value as one CSV cell: a list of words joined with "|", anything with structure as JSON. */
function csvValue(value: unknown): CsvCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.every((item) => typeof item !== "object" || item === null) ? value.join("|") : JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return value as CsvCell;
}

/** The child lists JSON carries but a CSV row leaves out. */
const childKeys = new Set(["words", "targets", "questions", "sentences"]);

export function itemsCsv(slug: LibrarySlug, items: Item[]): string {
  if (slug === "words") return toCsv([[...wordCsvColumns], ...items.map((item) => wordCsvColumns.map((column) => csvValue(item[column])))]);
  const columns = [...new Set(items.flatMap((item) => Object.keys(item)))].filter(
    (key) => !(slug === "sentences" || slug === "texts" || slug === "dialogues") || !childKeys.has(key),
  );
  return toCsv([columns, ...items.map((item) => columns.map((column) => csvValue(item[column])))]);
}

export function itemsJson(slug: LibrarySlug, language: LanguageCode, items: Item[], now = new Date()) {
  return JSON.stringify({ language, type: slug, exported_at: now.toISOString(), count: items.length, items }, null, 2);
}

/** Every type of one language in one JSON file: a full backup of its content. */
export async function allJson(language: LanguageCode, now = new Date()) {
  const types: Record<string, Item[]> = {};
  for (const slug of librarySlugs) types[slug] = await exportItems(slug, language);
  return JSON.stringify({ language, exported_at: now.toISOString(), types }, null, 2);
}
