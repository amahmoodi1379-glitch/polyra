"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { isLibrarySlug } from "@/server/content/library/slugs";
import { decideReview, type DecideResult, type Mastery, type ReviewDecision } from "@/server/content/review/decide";
import { logError } from "@/server/errors";

export type DecideOutcome = DecideResult | { state: "failed" };

/**
 * «تأیید» or «رد» on «بازبینی»; the log row names the admin who saw the item. The page has already
 * moved on to the next item when this answers, so only a refusal comes back to be shown.
 */
export async function decide(slug: string, language: string, id: number, decision: ReviewDecision, mastery: Mastery | null): Promise<DecideOutcome> {
  const admin = await requireAdmin();
  if (!isLibrarySlug(slug) || !isLanguage(language) || !Number.isInteger(id) || (decision !== "approve" && decision !== "reject")) return { state: "gone" };
  try {
    const result = await decideReview(slug, language, id, decision, admin.id, mastery === "produce" || mastery === "recognize" ? { mastery } : {});
    revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    await logError("review.decide", error, { userId: admin.id });
    return { state: "failed" };
  }
}
