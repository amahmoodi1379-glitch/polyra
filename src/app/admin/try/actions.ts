"use server";

import { revalidatePath } from "next/cache";
import { TRAVEL_DAYS } from "@/lib/travel";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { SESSION_LENGTHS, setSessionLength } from "@/server/learn/enroll";
import { startRehearse } from "@/server/learn/rehearse-jobs";
import { beginPlacement } from "@/server/learn/placement";
import { rehearsePlacement } from "@/server/learn/rehearse";
import { resetProgress } from "@/server/learn/enroll";
import { travelDays } from "@/server/learn/time-travel";

/** «آزمایش مثل زبان‌آموز»: every action changes only the signed-in teacher's own progress in one language. */

export async function playScenario(language: string, scenario: string, minutes: number): Promise<"started" | "busy" | "unknown"> {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return "unknown";
  if ((SESSION_LENGTHS as readonly number[]).includes(minutes)) await setSessionLength(admin.id, minutes);
  const result = startRehearse(admin, language, scenario);
  revalidatePath("/admin/try");
  return result;
}

export async function moveTime(language: string, days: number) {
  const admin = await requireAdmin();
  if (!isLanguage(language) || !(TRAVEL_DAYS as readonly number[]).includes(days)) return;
  await travelDays(admin, language, days);
  revalidatePath("/admin/try");
}

/** «خودم آزمون را می‌دهم»: progress in this language is wiped and the test starts; the app opens on its first question. */
export async function placeMyself(language: string): Promise<boolean> {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return false;
  await resetProgress(admin, language);
  const begun = await beginPlacement(admin, language);
  revalidatePath("/admin/try");
  return begun === "started";
}

/** «یک زبان‌آموز ساختگی آزمون بدهد»: one who knows the levels up to `known` (null: a beginner) takes the test on this account. */
export async function placeMadeUp(language: string, known: string | null): Promise<boolean> {
  const admin = await requireAdmin();
  if (!isLanguage(language) || (known !== null && !/^[ABC][12]$/.test(known))) return false;
  const result = await rehearsePlacement(admin, language, known);
  revalidatePath("/admin/try");
  return result !== null;
}
