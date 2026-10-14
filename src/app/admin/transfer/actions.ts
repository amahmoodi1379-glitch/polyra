"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { importWordsCsv, type CsvReport } from "@/server/content/transfer/words-csv";
import { logError } from "@/server/errors";

export type CsvReply = CsvReport | { state: "error"; code: string };

/**
 * The word file (PRD §14.7): `save` false checks it and says what would change; true imports it.
 * The file is read in the browser and sent as text.
 */
export async function wordsCsv(language: string, text: string, save: boolean): Promise<CsvReply> {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return { state: "invalid", reason: "empty" };
  try {
    const report = await importWordsCsv({ language, text, adminId: admin.id, dryRun: !save });
    if (report.state === "imported") revalidatePath("/admin", "layout");
    return report;
  } catch (error) {
    return { state: "error", code: await logError("transfer.wordsCsv", error, { userId: admin.id }) };
  }
}
