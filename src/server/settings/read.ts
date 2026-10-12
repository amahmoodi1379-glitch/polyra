import { db } from "@/server/db";
import { appSettingDefaults } from "./app-catalog";
import { engineCatalog } from "./engine-catalog";

/** A number from `engine_setting`, falling back to the catalog default if the row is missing. */
export async function engineNumber(key: string): Promise<number> {
  const row = await db.engineSetting.findUnique({ where: { key }, select: { value: true } });
  const value = row?.value ?? engineCatalog.find((def) => def.key === key)?.default;
  if (typeof value !== "number") throw new Error(`Engine setting ${key} is not a number`);
  return value;
}

/** A value from `app_setting`, falling back to the catalog default if the row is missing. */
export async function appSetting<T>(key: string): Promise<T> {
  const row = await db.appSetting.findUnique({ where: { key }, select: { value: true } });
  const value = row?.value ?? appSettingDefaults[key];
  if (value === undefined) throw new Error(`App setting ${key} is unknown`);
  return value as T;
}
