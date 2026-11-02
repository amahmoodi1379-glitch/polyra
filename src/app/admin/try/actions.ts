"use server";

import { revalidatePath } from "next/cache";
import { TRAVEL_DAYS } from "@/lib/travel";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { SESSION_LENGTHS, setSessionLength } from "@/server/learn/enroll";
import { startRehearse } from "@/server/learn/rehearse-jobs";
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
