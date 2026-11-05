"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { isLibrarySlug } from "@/server/content/library/slugs";
import { decideReview, type DecideResult, type Mastery, type ReviewDecision } from "@/server/content/review/decide";
import { logError } from "@/server/errors";

export type DecideOutcome = DecideResult | { state: "failed" };

/**
 * «تأیید» or «رد» on «بازبینی»; the log row names the admin who saw the item. Once decided, the next
 * item opens in the same reply from the server (`then`), so the teacher waits for one trip, not three.
 */
export async function decide(
  slug: string,
  language: string,
  id: number,
  decision: ReviewDecision,
  mastery: Mastery | null,
  then?: string,
): Promise<DecideOutcome> {
  const admin = await requireAdmin();
  if (!isLibrarySlug(slug) || !isLanguage(language) || !Number.isInteger(id) || (decision !== "approve" && decision !== "reject")) return { state: "gone" };
  let result: DecideOutcome;
  try {
    result = await decideReview(slug, language, id, decision, admin.id, mastery === "produce" || mastery === "recognize" ? { mastery } : {});
    revalidatePath("/admin", "layout");
  } catch (error) {
    await logError("review.decide", error, { userId: admin.id });
    return { state: "failed" };
  }
  if ((result.state === "done" || result.state === "gone") && then && /^\/admin\/review(?:\?|$)/.test(then)) redirect(then);
  return result;
}
