import type { ImportBatch } from "@/generated/prisma/client";
import { appSetting } from "@/server/settings/read";
import { languageInfo, type LanguageCode } from "../languages";
import { problem, type Problem } from "../problems";
import { readTemplate } from "../template";

/** A level must be one of the language's levels (general settings), not just any CEFR code. */
export const levelProblem = (levels: string[], level: string, field = "level"): Problem[] =>
  levels.includes(level) ? [] : [problem("levelOutside", { value: level, levels: levels.join("، "), field })];

export const levelOutside = async (language: string, level: string, field = "level") => levelProblem(await appSetting<string[]>(`levels.${language}`), level, field);

export async function batchSize(kind: string, fallback: number) {
  const sizes = await appSetting<Record<string, number>>("batch.sizes");
  const size = sizes[kind];
  return typeof size === "number" && size > 0 ? size : fallback;
}

/** The answer example for this prompt in this language, from prompts/<version>/examples. */
export function example(kind: string, language: LanguageCode) {
  return readTemplate(`examples/${kind}.${language}.json`);
}

export function languageValues(language: LanguageCode) {
  return { language: languageInfo[language].name_fa, exam: languageInfo[language].exam };
}

/** Fields every imported record carries so a systematic mistake can be traced (PRD §14.9). */
export function trace(batch: ImportBatch) {
  return { prompt_version: batch.prompt_version, model_name: batch.model_name, import_batch_id: batch.id };
}

export function params<T>(batch: ImportBatch): T {
  return (batch.params ?? {}) as T;
}

/** The text fields `keys` of a record (an object from a chatbot answer), the ones that are strings. */
export function texts(record: unknown, keys: string[]): string[] {
  if (!record || typeof record !== "object") return [];
  return keys.map((key) => (record as Record<string, unknown>)[key]).filter((value): value is string => typeof value === "string");
}

/**
 * Whether an answer was made for this batch (`ContentKind.matches`): at least one record names
 * something the batch asked for, or there are no records (the chatbot says why in `issues`).
 */
export const namesAsked = (records: unknown[], asked: Set<string>, names: (record: unknown) => string[]) =>
  records.length === 0 || records.some((record) => names(record).some((name) => asked.has(name)));

/** A short label for a record in the report: its lemma, code or text, else its position. */
export function labelOf(record: unknown, keys: string[], index: number) {
  if (record && typeof record === "object") {
    for (const key of keys) {
      const value = (record as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return `#${index + 1}`;
}

/** Lines for a prompt list, or «هیچ» when there is nothing. */
export function lines(items: string[]) {
  return items.length > 0 ? items.join("\n") : "هیچ";
}
