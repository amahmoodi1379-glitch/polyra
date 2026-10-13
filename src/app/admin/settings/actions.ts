"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { logError } from "@/server/errors";
import { saveEngineSettings, type EngineSaveResult } from "@/server/settings/engine";
import { saveGeneralSettings, type GeneralSaveResult } from "@/server/settings/general";

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** «ذخیره» on «تنظیمات موتور»: only the keys the teacher changed. */
export async function saveEngineAction(changes: Record<string, unknown>): Promise<EngineSaveResult | { state: "failed" }> {
  const admin = await requireAdmin();
  if (!isRecord(changes)) return { state: "failed" };
  try {
    const result = await saveEngineSettings(changes, admin.id);
    if (result.state === "saved") revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    await logError("settings.engine", error, { userId: admin.id });
    return { state: "failed" };
  }
}

/** «ذخیره» on «تنظیمات عمومی»: only the fields the teacher changed. */
export async function saveGeneralAction(changes: Record<string, unknown>): Promise<GeneralSaveResult | { state: "failed" }> {
  const admin = await requireAdmin();
  if (!isRecord(changes)) return { state: "failed" };
  try {
    const result = await saveGeneralSettings(changes, admin.id);
    if (result.state === "saved") revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    await logError("settings.general", error, { userId: admin.id });
    return { state: "failed" };
  }
}
