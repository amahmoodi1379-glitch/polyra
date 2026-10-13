"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { revertChange, type RevertResult } from "@/server/content/library/revert";
import { logError } from "@/server/errors";

export type RevertOutcome = RevertResult | { state: "failed" };

/** «برگردان» on one row of the change log (PRD §13.2). */
export async function revertAction(logId: number): Promise<RevertOutcome> {
  const admin = await requireAdmin();
  if (!Number.isInteger(logId) || logId <= 0) return { state: "failed" };
  try {
    const result = await revertChange(logId, admin.id);
    if (result.state === "reverted") revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    await logError("log.revert", error, { userId: admin.id });
    return { state: "failed" };
  }
}
