import { t } from "@/i18n";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/content/kinds/types";
import { logChange, same } from "@/server/content/library/log";
import { engineCatalog, settingGroups, type EngineSettingDef, type SettingGroup } from "./engine-catalog";
import { checkRelations, checkValue, engineDef, type EngineValue, type SettingError } from "./engine-rules";

export { engineDef, shownValue, type EngineValue, type SettingError } from "./engine-rules";

/**
 * «تنظیمات موتور» (PRD §9.8, §13.2): every engine number with its default and allowed range. A value
 * outside the range, or one that breaks a rule between two numbers (the shares of a session add up
 * to 100%, a pass mark is not above its number of questions), is not saved. Each changed key is one
 * row in the change log, so «برگردان» can put it back on its own.
 */

export type EngineSettingView = Omit<EngineSettingDef, "default"> & { default: EngineValue; value: EngineValue };
export type EngineGroupView = { group: SettingGroup; name: string; settings: EngineSettingView[] };

export const ENGINE_ENTITY = "engine_setting";

/** Every key's value now, with the catalog default for a key the database does not have yet. */
export async function engineValues(tx: Tx = db): Promise<Record<string, EngineValue>> {
  const rows = await tx.engineSetting.findMany({ select: { key: true, value: true } });
  const stored = new Map(rows.map((row) => [row.key, row.value as EngineValue]));
  return Object.fromEntries(engineCatalog.map((def) => [def.key, stored.has(def.key) ? stored.get(def.key)! : def.default]));
}

/** The page: groups in the catalog's order, each key with its value now. */
export async function engineSettingsView(): Promise<EngineGroupView[]> {
  const values = await engineValues();
  return (Object.keys(settingGroups) as SettingGroup[]).map((group) => ({
    group,
    name: settingGroups[group],
    settings: engineCatalog.filter((def) => def.group === group).map((def) => ({ ...def, value: values[def.key] })),
  }));
}

/** Writes one key and its log row; `action` is "edit" for a save and "revert" for «برگردان». */
export async function writeEngineValue(tx: Tx, key: string, before: EngineValue, after: EngineValue, adminId: number, action: "edit" | "revert") {
  const def = engineDef(key)!;
  const value = (after ?? null) as Prisma.InputJsonValue;
  await tx.engineSetting.upsert({
    where: { key },
    update: { value, updated_by: adminId },
    create: {
      key,
      value,
      default_value: (def.default ?? null) as Prisma.InputJsonValue,
      min_value: def.min ?? null,
      max_value: def.max ?? null,
      description_fa: def.description_fa,
      updated_by: adminId,
    },
  });
  await logChange(tx, adminId, { action, entity: ENGINE_ENTITY, entityId: key, before: { value: before }, after: { value: after } });
}

export type EngineSaveResult = { state: "saved"; changed: string[] } | { state: "invalid"; errors: SettingError[] };

/** Saves the keys a teacher changed, all or none (PRD §13.2: a value out of range is not saved). */
export async function saveEngineSettings(changes: Record<string, unknown>, adminId: number): Promise<EngineSaveResult> {
  const errors: SettingError[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const def = engineDef(key);
    const problem = def ? checkValue(def, value) : t("admin.settings.engine.errors.unknown");
    if (problem) errors.push({ key, message: problem });
  }
  if (errors.length > 0) return { state: "invalid", errors };

  return db.$transaction(async (tx) => {
    const current = await engineValues(tx);
    const changed = Object.keys(changes).filter((key) => !same(current[key], changes[key]));
    const merged = { ...current, ...changes };
    const broken = checkRelations(merged, new Set(changed));
    if (broken.length > 0) return { state: "invalid" as const, errors: broken };
    for (const key of changed) await writeEngineValue(tx, key, current[key], changes[key] as EngineValue, adminId, "edit");
    return { state: "saved" as const, changed };
  });
}

/** «برگردان» of one logged key: only while it still holds what that change wrote, and if the old value still fits. */
export async function revertEngineRow(tx: Tx, key: string, before: unknown, after: unknown, adminId: number): Promise<"reverted" | "changed" | "invalid" | "gone"> {
  const def = engineDef(key);
  if (!def) return "gone";
  const current = await engineValues(tx);
  if (!same(current[key], after)) return "changed";
  if (checkValue(def, before) || checkRelations({ ...current, [key]: before }, new Set([key])).length > 0) return "invalid";
  await writeEngineValue(tx, key, current[key], before as EngineValue, adminId, "revert");
  return "reverted";
}
