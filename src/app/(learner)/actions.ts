"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, getCurrentUser } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { forgetContent } from "@/server/learn/content";
import { resetProgress, SESSION_LENGTHS, setSessionLength, startFromZero } from "@/server/learn/enroll";

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

const allowedLength = (minutes: number | null) => minutes !== null && (SESSION_LENGTHS as readonly number[]).includes(minutes);

/** «از صفر شروع می‌کنم» (PRD §3.1, step 4), with the session length asked the first time (step 3). */
export async function beginFromZero(language: string, minutes: number | null) {
  const user = await signedIn();
  if (!isLanguage(language)) return;
  if (allowedLength(minutes)) await setSessionLength(user.id, minutes!);
  await startFromZero(user, language);
  redirect(`/learn/${language}`);
}

/** The session length in the settings sheet; the same for both languages (PRD §3.1). */
export async function changeSessionLength(minutes: number) {
  const user = await signedIn();
  if (!allowedLength(minutes)) return;
  await setSessionLength(user.id, minutes);
  revalidatePath("/learn", "layout");
}

/** «پاک کردن پیشرفت من در این زبان», tester accounts only (PRD §13.5). */
export async function resetMyProgress(language: string) {
  const user = await signedIn();
  if (!isLanguage(language) || (!user.is_tester && !user.is_admin)) return;
  await resetProgress(user, language);
  forgetContent();
  redirect(`/start/${language}`);
}

export async function signOutLearner() {
  await endSession();
  redirect("/login");
}
