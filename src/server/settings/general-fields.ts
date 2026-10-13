import { t, type MessageKey } from "@/i18n";
import { languageCodes, levelRank, type LanguageCode } from "@/server/content/languages";
import type { SettingError } from "./engine-rules";

/**
 * The fields of «تنظیمات عمومی» (PRD §13.2) and the rules for their values, without the database, so
 * the page checks what a teacher types the same way the save does.
 */

export type GeneralSection = "texts" | "targets" | "making" | "lists";
export const generalSections: GeneralSection[] = ["texts", "targets", "making", "lists"];

type LanguageColumn = "coming_soon_fa" | "support_contact_fa";
type Common = { id: string; section: GeneralSection; label: MessageKey; help?: MessageKey };
export type GeneralField = Common &
  (
    | { kind: "text"; max: number; long?: boolean; source: { language: LanguageCode; column: LanguageColumn } | { key: string } }
    | { kind: "textMap"; key: string; keys: string[]; max: number }
    | { kind: "lines"; key: string; min: number; max: number; itemMax: number }
    | { kind: "levelLines"; key: string; min: number; max: number; itemMax: number }
    | { kind: "numbers"; key: string; keys: string[]; min: number; max: number }
    | { kind: "levelNumbers"; key: string; columns: string[]; min: number; max: number }
    | { kind: "ranges"; key: string; min: number; max: number; text?: boolean }
    | { kind: "lessons"; key: string; max: number }
  );

/** Shapes the page edits. */
export type Lesson = { label: string; kind: string };
export type GeneralValue =
  | string
  | string[]
  | Lesson[]
  | Record<string, string>
  | Record<string, number>
  | Record<string, string[]>
  | Record<string, Record<string, number>>
  | Record<string, [number, number]>;

const label = (id: string) => `admin.settings.general.fields.${id}` as MessageKey;
const languageName = (language: LanguageCode) => t(`common.languages.${language}`);
export const phonicsKinds = ["contrast", "rule", "liaison"];
/** The kinds a language's phonics lessons can have: liaison is French only (PRD §8.1). */
export const lessonKinds = (language: LanguageCode | null) => (language === "fr" ? phonicsKinds : phonicsKinds.filter((kind) => kind !== "liaison"));
const targetColumns = ["words", "phrases", "grammar_units", "texts", "translations", "dialogues", "errorfix", "writing"];

export const generalFields: GeneralField[] = [
  ...languageCodes.flatMap((language): GeneralField[] => [
    {
      id: `coming_soon_fa.${language}`,
      section: "texts",
      label: label("coming_soon_fa"),
      help: label("coming_soon_help"),
      kind: "text",
      max: 300,
      source: { language, column: "coming_soon_fa" },
    },
    {
      id: `support_contact_fa.${language}`,
      section: "texts",
      label: label("support_contact_fa"),
      help: label("support_contact_help"),
      kind: "text",
      max: 2000,
      long: true,
      source: { language, column: "support_contact_fa" },
    },
  ]),
  {
    id: "pace_estimate_fa",
    section: "texts",
    label: label("pace_estimate_fa"),
    help: label("pace_estimate_help"),
    kind: "textMap",
    key: "pace_estimate_fa",
    keys: ["10", "15", "20", "30"],
    max: 200,
  },
  { id: "terms_fa", section: "texts", label: label("terms_fa"), kind: "text", max: 50_000, long: true, source: { key: "terms_fa" } },
  { id: "privacy_fa", section: "texts", label: label("privacy_fa"), kind: "text", max: 50_000, long: true, source: { key: "privacy_fa" } },

  ...languageCodes.map(
    (language): GeneralField => ({
      id: `targets.${language}`,
      section: "targets",
      label: label("targets"),
      kind: "levelNumbers",
      key: `targets.${language}`,
      columns: targetColumns,
      min: 0,
      max: 100_000,
    }),
  ),

  { id: "chatbot_names", section: "making", label: label("chatbot_names"), help: label("chatbot_names_help"), kind: "lines", key: "chatbot_names", min: 1, max: 10, itemMax: 40 },
  {
    id: "batch.sizes",
    section: "making",
    label: label("batch.sizes"),
    help: label("batch.sizes_help"),
    kind: "numbers",
    key: "batch.sizes",
    keys: ["P-C", "P-W", "P-S", "P-X", "P-E", "P-WR"],
    min: 1,
    max: 1000,
  },
  { id: "prompt.sentence_length", section: "making", label: label("prompt.sentence_length"), kind: "ranges", key: "prompt.sentence_length", min: 1, max: 40, text: true },
  { id: "prompt.translation_length", section: "making", label: label("prompt.translation_length"), kind: "numbers", key: "prompt.translation_length", keys: [], min: 3, max: 40 },
  {
    id: "prompt.grammar_counts",
    section: "making",
    label: label("prompt.grammar_counts"),
    kind: "numbers",
    key: "prompt.grammar_counts",
    keys: ["targets", "transforms", "translations"],
    min: 1,
    max: 200,
  },
  { id: "prompt.writing_words", section: "making", label: label("prompt.writing_words"), kind: "ranges", key: "prompt.writing_words", min: 20, max: 1000 },
  {
    id: "prompt.text_topics",
    section: "making",
    label: label("prompt.text_topics"),
    help: label("prompt.text_topics_help"),
    kind: "lines",
    key: "prompt.text_topics",
    min: 1,
    max: 60,
    itemMax: 60,
  },
  {
    id: "prompt.dialogue_situations",
    section: "making",
    label: label("prompt.dialogue_situations"),
    help: label("prompt.dialogue_situations_help"),
    kind: "levelLines",
    key: "prompt.dialogue_situations",
    min: 1,
    max: 60,
    itemMax: 80,
  },

  ...languageCodes.map(
    (language): GeneralField => ({
      id: `conjugation.tenses.${language}`,
      section: "lists",
      label: label("conjugation.tenses"),
      help: label("conjugation.tenses_help"),
      kind: "levelLines",
      key: `conjugation.tenses.${language}`,
      min: 0,
      max: 10,
      itemMax: 40,
    }),
  ),
  ...languageCodes.map(
    (language): GeneralField => ({
      id: `phonics.lessons.${language}`,
      section: "lists",
      label: label("phonics.lessons"),
      help: label("phonics.lessons_help"),
      kind: "lessons",
      key: `phonics.lessons.${language}`,
      max: 40,
    }),
  ),
];

const byId = new Map(generalFields.map((field) => [field.id, field]));
export const generalField = (id: string) => byId.get(id);

/** The language a field belongs to, if it is one language's. */
export function fieldLanguage(field: GeneralField): LanguageCode | null {
  if (field.kind === "text" && "language" in field.source) return field.source.language;
  const last = field.id.split(".").at(-1) as LanguageCode;
  return languageCodes.includes(last) && field.id.includes(".") ? last : null;
}

/** The name a field goes by in the log and on the page, with its language when it has one. */
export function fieldTitle(field: GeneralField) {
  const language = fieldLanguage(field);
  return language ? t("admin.settings.general.withLanguage", { name: t(field.label), language: languageName(language) }) : t(field.label);
}

// The stored shape and the edited one.

const SENTENCE_RANGE = /^\s*(\d+)\s*تا\s*(\d+)\s*$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const byLevel = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => levelRank(a) - levelRank(b) || a.localeCompare(b)));

/** The stored value in the shape the page edits. */
export function editedShape(field: GeneralField, stored: unknown): GeneralValue {
  switch (field.kind) {
    case "text":
      return typeof stored === "string" ? stored : "";
    case "textMap": {
      const record = isRecord(stored) ? stored : {};
      return Object.fromEntries(field.keys.map((key) => [key, typeof record[key] === "string" ? (record[key] as string) : ""]));
    }
    case "lines":
      return Array.isArray(stored) ? stored.map(String) : [];
    case "levelLines":
      return byLevel(Object.fromEntries(Object.entries(isRecord(stored) ? stored : {}).map(([level, list]) => [level, Array.isArray(list) ? list.map(String) : []])));
    case "numbers": {
      const record = isRecord(stored) ? stored : {};
      const keys = field.keys.length > 0 ? field.keys : Object.keys(byLevel(record));
      return Object.fromEntries(keys.map((key) => [key, Number(record[key] ?? 0)]));
    }
    case "levelNumbers":
      return byLevel(
        Object.fromEntries(
          Object.entries(isRecord(stored) ? stored : {}).map(([level, row]) => [
            level,
            Object.fromEntries(field.columns.map((column) => [column, Number((isRecord(row) ? row[column] : 0) ?? 0)])),
          ]),
        ),
      );
    case "ranges":
      return byLevel(
        Object.fromEntries(
          Object.entries(isRecord(stored) ? stored : {}).map(([level, range]) => {
            const match = typeof range === "string" ? SENTENCE_RANGE.exec(range) : null;
            const pair = match ? [Number(match[1]), Number(match[2])] : Array.isArray(range) ? range.map(Number) : [0, 0];
            return [level, [pair[0] ?? 0, pair[1] ?? 0] as [number, number]];
          }),
        ),
      );
    case "lessons":
      return Array.isArray(stored) ? stored.map((item) => ({ label: String((item as Lesson).label ?? ""), kind: String((item as Lesson).kind ?? "rule") })) : [];
  }
}

// Checking an edited value.

const whole = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** What is wrong with an edited value; `key` is the field id, or the id and the place inside it. */
export function checkField(field: GeneralField, value: unknown): SettingError[] {
  const errors: SettingError[] = [];
  const add = (where: string, key: MessageKey, vars?: Record<string, string | number>) => errors.push({ key: where ? `${field.id}.${where}` : field.id, message: t(key, vars) });
  const shape = () => errors.push({ key: field.id, message: t("admin.settings.general.errors.shape") });
  const checkLines = (where: string, list: unknown, min: number, max: number, itemMax: number) => {
    if (!Array.isArray(list) || !list.every((line) => typeof line === "string")) return shape();
    const lines = list.map((line: string) => line.trim());
    if (lines.length < min) add(where, "admin.settings.general.errors.fewLines", { min });
    if (lines.length > max) add(where, "admin.settings.general.errors.manyLines", { max });
    if (lines.some((line) => line === "")) add(where, "admin.settings.general.errors.emptyLine");
    if (lines.some((line) => line.length > itemMax)) add(where, "admin.settings.general.errors.longLine", { max: itemMax });
    const seen = new Set<string>();
    const repeated = lines.find((line) => line !== "" && (seen.has(line.toLowerCase()) || !seen.add(line.toLowerCase())));
    if (repeated) add(where, "admin.settings.general.errors.repeated", { line: repeated });
  };

  switch (field.kind) {
    case "text":
      if (typeof value !== "string") return [{ key: field.id, message: t("admin.settings.general.errors.shape") }];
      if (value.trim().length > field.max) add("", "admin.settings.general.errors.tooLong", { max: field.max });
      break;
    case "textMap":
      if (!isRecord(value)) return [{ key: field.id, message: t("admin.settings.general.errors.shape") }];
      for (const key of field.keys) {
        const text = value[key];
        if (typeof text !== "string") add(key, "admin.settings.general.errors.shape");
        else if (text.trim().length > field.max) add(key, "admin.settings.general.errors.tooLong", { max: field.max });
      }
      break;
    case "lines":
      checkLines("", value, field.min, field.max, field.itemMax);
      break;
    case "levelLines":
      if (!isRecord(value)) return [{ key: field.id, message: t("admin.settings.general.errors.shape") }];
      for (const [level, list] of Object.entries(value)) checkLines(level, list, field.min, field.max, field.itemMax);
      break;
    case "numbers":
      if (!isRecord(value)) return [{ key: field.id, message: t("admin.settings.general.errors.shape") }];
      for (const [key, number] of Object.entries(value))
        if (!whole(number, field.min, field.max)) add(key, "admin.settings.general.errors.range", { min: field.min, max: field.max });
      break;
    case "levelNumbers":
      if (!isRecord(value)) return [{ key: field.id, message: t("admin.settings.general.errors.shape") }];
      for (const [level, row] of Object.entries(value)) {
        if (!isRecord(row)) {
          add(level, "admin.settings.general.errors.shape");
          continue;
        }
        for (const column of field.columns)
          if (!whole(row[column], field.min, field.max)) add(`${level}.${column}`, "admin.settings.general.errors.range", { min: field.min, max: field.max });
      }
      break;
    case "ranges":
      if (!isRecord(value)) return [{ key: field.id, message: t("admin.settings.general.errors.shape") }];
      for (const [level, range] of Object.entries(value)) {
        if (!Array.isArray(range) || range.length !== 2 || !range.every((number) => whole(number, field.min, field.max))) {
          add(level, "admin.settings.general.errors.range", { min: field.min, max: field.max });
        } else if (range[0] > range[1]) add(level, "admin.settings.general.errors.order");
      }
      break;
    case "lessons": {
      if (!Array.isArray(value)) return [{ key: field.id, message: t("admin.settings.general.errors.shape") }];
      if (value.length < 1) add("", "admin.settings.general.errors.fewLines", { min: 1 });
      if (value.length > field.max) add("", "admin.settings.general.errors.manyLines", { max: field.max });
      const seen = new Set<string>();
      value.forEach((lesson: unknown, index) => {
        const row = isRecord(lesson) ? lesson : {};
        const name = typeof row.label === "string" ? row.label.trim() : "";
        if (name === "") add(String(index), "admin.settings.general.errors.emptyLine");
        else if (name.length > 60) add(String(index), "admin.settings.general.errors.longLine", { max: 60 });
        else if (seen.has(name)) add(String(index), "admin.settings.general.errors.repeated", { line: name });
        seen.add(name);
        if (typeof row.kind !== "string" || !phonicsKinds.includes(row.kind)) add(String(index), "admin.settings.general.errors.shape");
        else if (!lessonKinds(fieldLanguage(field)).includes(row.kind)) add(String(index), "admin.settings.general.errors.liaisonFrench");
      });
      break;
    }
  }
  return errors;
}

export type GeneralFieldView = GeneralField & { title: string; value: GeneralValue; language: LanguageCode | null };

export const APP_ENTITY = "app_setting";
export const LANGUAGE_TEXT_ENTITY = "language_text";

/** Where a field is logged: its own table row. */
export function logTarget(field: GeneralField) {
  if (field.kind === "text" && "language" in field.source) return { entity: LANGUAGE_TEXT_ENTITY, entityId: `${field.source.language}:${field.source.column}` };
  return { entity: APP_ENTITY, entityId: field.kind === "text" ? (field.source as { key: string }).key : field.key };
}

/** The field a log row is about. */
export function fieldOfLog(entity: string, entityId: string | null): GeneralField | undefined {
  return generalFields.find((field) => {
    const target = logTarget(field);
    return target.entity === entity && target.entityId === entityId;
  });
}
