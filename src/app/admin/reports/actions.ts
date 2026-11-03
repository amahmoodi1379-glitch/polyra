"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { logError } from "@/server/errors";
import { acceptAnswer, markFixed, rejectReport, setReportPriority, suspendReported, type ReportAction } from "@/server/reports/admin";

export type ReportOutcome = ReportAction | { ok: false; reason: "failed" };
export type ReportStep = "accept" | "fixed" | "fixedRight" | "suspend" | "reject" | "high" | "normal";

/** One of the four answers to a report, or its priority (PRD §13.10). */
export async function actOnReport(id: number, step: ReportStep): Promise<ReportOutcome> {
  const admin = await requireAdmin();
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: "gone" };
  try {
    let outcome: ReportAction;
    switch (step) {
      case "accept":
        outcome = await acceptAnswer(admin.id, id);
        break;
      case "fixed":
      case "fixedRight":
        outcome = await markFixed(admin.id, id, step === "fixedRight");
        break;
      case "suspend":
        outcome = await suspendReported(admin.id, id);
        break;
      case "reject":
        outcome = await rejectReport(admin.id, id);
        break;
      case "high":
      case "normal":
        await setReportPriority(id, step);
        outcome = { ok: true, right: false };
        break;
      default:
        return { ok: false, reason: "gone" };
    }
    revalidatePath("/admin", "layout");
    return outcome;
  } catch (error) {
    await logError("reports.act", error, { userId: admin.id });
    return { ok: false, reason: "failed" };
  }
}
