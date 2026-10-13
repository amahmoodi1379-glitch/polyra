import { t } from "@/i18n";
import { engineCatalog, type EngineSettingDef } from "./engine-catalog";

/**
 * The rules of «تنظیمات موتور» without the database, so the page checks a value as it is typed and
 * the server checks it again on save: each key's type and range, and the rules between keys.
 */

export type EngineValue = number | boolean | number[] | null;
export type SettingError = { key: string; message: string };

const byKey = new Map(engineCatalog.map((def) => [def.key, def]));
export const engineDef = (key: string) => byKey.get(key);

/** FSRS weight lists the memory library accepts: FSRS-4.5, FSRS-5 and FSRS-6. */
const WEIGHT_COUNTS = [17, 19, 21];
/** Shares are typed as percents with one decimal, so two sums that differ by less than this are equal. */
const SUM_SLACK = 1e-6;

type Relation = { kind: "sum"; keys: string[]; name: "session" | "backlog" } | { kind: "atMost" | "below"; small: string; big: string };

/** Rules between keys that no single range can hold. */
export const engineRelations: Relation[] = [
  { kind: "sum", keys: ["share.review", "share.notebook", "share.production", "share.new"], name: "session" },
  { kind: "sum", keys: ["backlog.share.review", "backlog.share.notebook", "backlog.share.production", "backlog.share.new"], name: "backlog" },
  { kind: "atMost", small: "placement.pass_min", big: "placement.block_size" },
  { kind: "atMost", small: "exam.pass_min", big: "exam.size" },
  { kind: "below", small: "pace.slow_below", big: "pace.normal_at" },
  { kind: "atMost", small: "new.words_daily_soft", big: "new.words_daily_hard" },
  { kind: "atMost", small: "speak.max_words_low", big: "speak.max_words_high" },
  { kind: "atMost", small: "publish.word_min_targets", big: "publish.word_goal_targets" },
  { kind: "below", small: "text.gap2_days", big: "text.gap3_days" },
  { kind: "atMost", small: "pretest.trigger_count", big: "pretest.window" },
];

/** A value as the panel shows it: a ratio as a percent, a switch as on or off. */
export function shownValue(def: Pick<EngineSettingDef, "type">, value: unknown): string {
  if (value === null || value === undefined) return t("admin.settings.engine.empty");
  if (def.type === "bool") return t(value ? "admin.settings.engine.on" : "admin.settings.engine.off");
  if (def.type === "ratio" && typeof value === "number") return t("admin.settings.engine.percent", { value: Math.round(value * 1000) / 10 });
  if (def.type === "weights" && Array.isArray(value)) return t("admin.settings.engine.weightsCount", { count: value.length });
  return typeof value === "number" ? t("admin.settings.engine.number", { value }) : String(value);
}

const bounds = (def: EngineSettingDef) => ({ min: shownValue(def, def.min ?? 0), max: shownValue(def, def.max ?? 0) });

/** What is wrong with one value on its own, or null. */
export function checkValue(def: EngineSettingDef, value: unknown): string | null {
  const range = (number: number) => (def.min !== undefined && number < def.min) || (def.max !== undefined && number > def.max);
  switch (def.type) {
    case "bool":
      return typeof value === "boolean" ? null : t("admin.settings.engine.errors.bool");
    case "weights":
      if (value === null) return null;
      return Array.isArray(value) && WEIGHT_COUNTS.includes(value.length) && value.every((item) => typeof item === "number" && Number.isFinite(item))
        ? null
        : t("admin.settings.engine.errors.weights");
    case "choice":
      return typeof value === "number" && (def.options ?? []).includes(value) ? null : t("admin.settings.engine.errors.choice");
    case "optional_int":
      if (value === null) return null;
    // falls through: a value that is there is a whole number in range
    case "int":
      if (typeof value !== "number" || !Number.isFinite(value)) return t("admin.settings.engine.errors.number");
      if (!Number.isInteger(value)) return t("admin.settings.engine.errors.whole");
      return range(value) ? t("admin.settings.engine.errors.range", bounds(def)) : null;
    case "number":
    case "ratio":
      if (typeof value !== "number" || !Number.isFinite(value)) return t("admin.settings.engine.errors.number");
      return range(value) ? t("admin.settings.engine.errors.range", bounds(def)) : null;
  }
}

const describe = (key: string) => (engineDef(key)?.description_fa ?? key).replace(/[.…]+$/, "");

/** Rules between keys broken by `values`, reported on the keys in `touched` (all keys when absent). */
export function checkRelations(values: Record<string, unknown>, touched?: Set<string>): SettingError[] {
  const errors: SettingError[] = [];
  const counts = (key: string) => !touched || touched.has(key);
  for (const relation of engineRelations) {
    if (relation.kind === "sum") {
      const numbers = relation.keys.map((key) => values[key]);
      if (!numbers.every((value) => typeof value === "number")) continue;
      const sum = (numbers as number[]).reduce((total, value) => total + value, 0);
      if (Math.abs(sum - 1) <= SUM_SLACK) continue;
      const message = t(`admin.settings.engine.errors.sum.${relation.name}`, { sum: Math.round(sum * 1000) / 10 });
      for (const key of relation.keys) if (counts(key)) errors.push({ key, message });
      continue;
    }
    const small = values[relation.small];
    const big = values[relation.big];
    if (typeof small !== "number" || typeof big !== "number") continue;
    if (relation.kind === "atMost" ? small <= big : small < big) continue;
    const kind = relation.kind === "atMost" ? "atMost" : "below";
    if (counts(relation.small)) errors.push({ key: relation.small, message: t(`admin.settings.engine.errors.${kind}`, { other: describe(relation.big) }) });
    if (counts(relation.big)) errors.push({ key: relation.big, message: t(`admin.settings.engine.errors.${kind}Big`, { other: describe(relation.small) }) });
  }
  return errors;
}
