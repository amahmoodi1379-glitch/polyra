import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Tx } from "@/server/content/kinds/types";
import { logChange, same } from "@/server/content/library/log";
import { t } from "@/i18n";
import { appSettingDefaults } from "./app-catalog";
import type { SettingError } from "./engine-rules";
import {
  checkField,
  editedShape,
  generalField,
  generalFields,
  fieldLanguage,
  fieldTitle,
  logTarget,
  type GeneralField,
  type GeneralFieldView,
  type GeneralValue,
  type Lesson,
} from "./general-fields";

export * from "./general-fields";

/**
 * «تنظیمات عمومی» (PRD §13.2): texts learners read, each level's content targets, and the lists and
 * numbers the content prompts use. Every field is edited in a plain shape (numbers, lines, ranges)
 * and stored in the shape the app reads. Each changed field is one row in the change log.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The value as the app stores it, or the catalog default. */
async function storedValue(tx: Tx, field: GeneralField): Promise<unknown> {
  if (field.kind === "text" && "language" in field.source) {
    const row = await tx.language.findUnique({ where: { code: field.source.language }, select: { [field.source.column]: true } });
    return (row as Record<string, unknown> | null)?.[field.source.column] ?? null;
  }
  const key = field.kind === "text" ? (field.source as { key: string }).key : field.key;
  const row = await tx.appSetting.findUnique({ where: { key }, select: { value: true } });
  return row ? row.value : appSettingDefaults[key];
}

/** The edited value in the shape the app reads; keys the page does not show are kept. */
function storedShape(field: GeneralField, edited: GeneralValue, stored: unknown): unknown {
  switch (field.kind) {
    case "text":
      return (edited as string).trim() === "" && "language" in field.source ? null : (edited as string).trim();
    case "textMap":
      return Object.fromEntries(
        Object.entries(edited as Record<string, string>)
          .filter(([, text]) => text.trim() !== "")
          .map(([key, text]) => [key, text.trim()]),
      );
    case "lines":
      return (edited as string[]).map((line) => line.trim());
    case "levelLines":
      return Object.fromEntries(Object.entries(edited as Record<string, string[]>).map(([level, list]) => [level, list.map((line) => line.trim())]));
    case "numbers":
      return { ...(isRecord(stored) ? stored : {}), ...(edited as Record<string, number>) };
    case "levelNumbers": {
      const old = isRecord(stored) ? stored : {};
      return Object.fromEntries(
        Object.entries(edited as Record<string, Record<string, number>>).map(([level, row]) => [level, { ...(isRecord(old[level]) ? old[level] : {}), ...row }]),
      );
    }
    case "ranges":
      return Object.fromEntries(Object.entries(edited as Record<string, [number, number]>).map(([level, [low, high]]) => [level, field.text ? `${low} تا ${high}` : [low, high]]));
    case "lessons":
      return (edited as Lesson[]).map((lesson) => ({ label: lesson.label.trim(), kind: lesson.kind }));
  }
}

async function writeStored(tx: Tx, field: GeneralField, value: unknown, adminId: number) {
  if (field.kind === "text" && "language" in field.source) {
    await tx.language.update({ where: { code: field.source.language }, data: { [field.source.column]: value as string | null } });
    return;
  }
  const key = field.kind === "text" ? (field.source as { key: string }).key : field.key;
  const json = value as Prisma.InputJsonValue;
  await tx.appSetting.upsert({ where: { key }, update: { value: json, updated_by: adminId }, create: { key, value: json, updated_by: adminId } });
}

// Reading, saving and putting back.

export async function generalSettingsView(): Promise<GeneralFieldView[]> {
  return Promise.all(
    generalFields.map(async (field) => ({ ...field, title: fieldTitle(field), language: fieldLanguage(field), value: editedShape(field, await storedValue(db, field)) })),
  );
}

export type GeneralSaveResult = { state: "saved"; changed: string[]; values: Record<string, GeneralValue> } | { state: "invalid"; errors: SettingError[] };

/** Saves the fields a teacher changed, all or none. */
export async function saveGeneralSettings(changes: Record<string, unknown>, adminId: number): Promise<GeneralSaveResult> {
  const errors: SettingError[] = [];
  for (const [id, value] of Object.entries(changes)) {
    const field = generalField(id);
    if (!field) errors.push({ key: id, message: t("admin.settings.general.errors.unknown") });
    else errors.push(...checkField(field, value));
  }
  if (errors.length > 0) return { state: "invalid", errors };

  return db.$transaction(async (tx) => {
    const changed: string[] = [];
    const values: Record<string, GeneralValue> = {};
    for (const [id, value] of Object.entries(changes)) {
      const field = generalField(id)!;
      const before = await storedValue(tx, field);
      const after = storedShape(field, value as GeneralValue, before);
      values[id] = editedShape(field, after);
      if (same(before, after)) continue;
      await writeStored(tx, field, after, adminId);
      await logChange(tx, adminId, { action: "edit", ...logTarget(field), before: { value: before ?? null }, after: { value: after } });
      changed.push(id);
    }
    return { state: "saved" as const, changed, values };
  });
}

/** «برگردان» of one logged field: only while it still holds what that change wrote. */
export async function revertGeneralRow(tx: Tx, field: GeneralField, before: unknown, after: unknown, adminId: number): Promise<"reverted" | "changed" | "invalid"> {
  const now = await storedValue(tx, field);
  if (!same(now ?? null, after ?? null)) return "changed";
  if (checkField(field, editedShape(field, before)).length > 0) return "invalid";
  await writeStored(tx, field, before, adminId);
  await logChange(tx, adminId, { action: "revert", ...logTarget(field), before: { value: now ?? null }, after: { value: before ?? null } });
  return "reverted";
}
