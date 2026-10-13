import type { AdminLog } from "@/generated/prisma/client";
import { formatNumber, t, type MessageKey } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { wordDiff } from "@/lib/text-diff";
import type { ChangeLine, Shown } from "@/server/content/library/history";
import { ENGINE_ENTITY, engineDef, shownValue } from "./engine";
import { settingGroups } from "./engine-catalog";
import { editedShape, fieldLanguage, fieldOfLog, fieldTitle, type GeneralField, type Lesson } from "./general-fields";

/**
 * How «تاریخچه تغییرها» shows a change of «تنظیمات موتور» or «تنظیمات عمومی»: the key or field by
 * its Persian name, and what changed inside it in plain words.
 */

const fa = (text: string): Shown => (text === "" ? null : { text, voice: "fa" });
const LONG_TEXT = 60;

export type SettingLog = { kindLabel: string; title: Shown; href: string; language: string | null; lines: ChangeLine[] };

export function settingLog(row: AdminLog): SettingLog | null {
  const before = (row.before as { value?: unknown } | null)?.value ?? null;
  const after = (row.after as { value?: unknown } | null)?.value ?? null;
  if (row.entity === ENGINE_ENTITY) {
    const def = engineDef(row.entity_id ?? "");
    if (!def) return null;
    return {
      kindLabel: t("admin.nav.engine"),
      title: fa(def.description_fa),
      href: `/admin/settings/engine#setting-${encodeURIComponent(def.key)}`,
      language: null,
      lines: [{ key: "value", label: settingGroups[def.group], before: fa(shownValue(def, before)), after: fa(shownValue(def, after)) }],
    };
  }
  const field = fieldOfLog(row.entity, row.entity_id);
  if (!field) return null;
  const language = fieldLanguage(field);
  return {
    kindLabel: t("admin.nav.general"),
    title: fa(fieldTitle(field)),
    href: `/admin/settings/general${language ? `?lang=${language}` : ""}#${encodeURIComponent(field.id)}`,
    language,
    lines: fieldChanges(field, editedShape(field, before), editedShape(field, after)),
  };
}

const levelLabel = (level: string) => `⁦${level}⁩`;
const sub = (key: string) => {
  const name = `admin.settings.general.parts.${key}` as MessageKey;
  return t(name) === name ? isolateLatin(key) : t(name);
};

function textLine(key: string, label: string, from: string, to: string): ChangeLine[] {
  if (from === to) return [];
  if (from && to && Math.max(from.length, to.length) > LONG_TEXT) return [{ key, label, diff: { parts: wordDiff(from, to), voice: "fa" } }];
  return [{ key, label, before: fa(from), after: fa(to) }];
}

/** Lines added and taken out of a list: «اضافه: …؛ برداشته: …». */
function listLine(key: string, label: string, from: string[], to: string[]): ChangeLine[] {
  const added = to.filter((line) => !from.includes(line));
  const removed = from.filter((line) => !to.includes(line));
  const parts = [
    added.length > 0 ? t("admin.settings.general.log.added", { list: isolateLatin(added.join("، ")) }) : "",
    removed.length > 0 ? t("admin.settings.general.log.removed", { list: isolateLatin(removed.join("، ")) }) : "",
  ].filter(Boolean);
  if (parts.length === 0) return from.join("\n") === to.join("\n") ? [] : [{ key, label, note: t("admin.settings.general.log.reordered") }];
  return [{ key, label, note: parts.join("؛ ") }];
}

const number = (value: number | undefined) => fa(value === undefined ? "" : formatNumber(value));
const range = (value: [number, number] | undefined) => fa(value ? t("admin.settings.general.log.range", { low: value[0], high: value[1] }) : "");

function fieldChanges(field: GeneralField, from: unknown, to: unknown): ChangeLine[] {
  const label = t(field.label);
  switch (field.kind) {
    case "text":
      return textLine(field.id, label, from as string, to as string);
    case "textMap": {
      const a = from as Record<string, string>;
      const b = to as Record<string, string>;
      return field.keys.flatMap((key) => textLine(key, t("admin.settings.general.minutes", { count: Number(key) }), a[key] ?? "", b[key] ?? ""));
    }
    case "lines":
      return listLine(field.id, label, from as string[], to as string[]);
    case "levelLines": {
      const a = from as Record<string, string[]>;
      const b = to as Record<string, string[]>;
      return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((level) => listLine(level, levelLabel(level), a[level] ?? [], b[level] ?? []));
    }
    case "numbers": {
      const a = from as Record<string, number>;
      const b = to as Record<string, number>;
      return Object.keys(b)
        .filter((key) => a[key] !== b[key])
        .map((key) => ({ key, label: sub(key), before: number(a[key]), after: number(b[key]) }));
    }
    case "levelNumbers": {
      const a = from as Record<string, Record<string, number>>;
      const b = to as Record<string, Record<string, number>>;
      return Object.keys(b).flatMap((level) =>
        field.columns
          .filter((column) => a[level]?.[column] !== b[level]?.[column])
          .map((column) => ({ key: `${level}.${column}`, label: `${levelLabel(level)} · ${sub(column)}`, before: number(a[level]?.[column]), after: number(b[level]?.[column]) })),
      );
    }
    case "ranges": {
      const a = from as Record<string, [number, number]>;
      const b = to as Record<string, [number, number]>;
      return Object.keys(b)
        .filter((level) => String(a[level]) !== String(b[level]))
        .map((level) => ({ key: level, label: levelLabel(level), before: range(a[level]), after: range(b[level]) }));
    }
    case "lessons": {
      const name = (lesson: Lesson) => `${lesson.label} (${t(`admin.settings.general.phonicsKinds.${lesson.kind}` as MessageKey)})`;
      return listLine(field.id, label, (from as Lesson[]).map(name), (to as Lesson[]).map(name));
    }
  }
}
