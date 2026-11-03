"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, getCurrentUser } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { forgetContent } from "@/server/learn/content";
import { resetProgress, SESSION_LENGTHS, setSessionLength, startFromZero } from "@/server/learn/enroll";
import { beginExam, EXAM_SKILLS, examInput, examScreen, type ExamInput, type ExamScreen } from "@/server/learn/exam";
import { beginPlacement, placementInput, type PlacementInput, type PlacementScreen } from "@/server/learn/placement";
import type { SkillName } from "@/engine/state";
import { TRAVEL_DAYS } from "@/lib/travel";
import { travelDays } from "@/server/learn/time-travel";

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

/** «تعیین سطح» (PRD §3.1 step 4, §11.1): the enrollment and the test, with the session length asked the first time. */
export async function beginPlacementTest(language: string, minutes: number | null) {
  const user = await signedIn();
  if (!isLanguage(language)) return;
  if (allowedLength(minutes)) await setSessionLength(user.id, minutes!);
  const started = await beginPlacement(user, language);
  redirect(started === "taken" ? `/learn/${language}` : `/learn/${language}/placement`);
}

/** One answer of the test, «ادامه نمی‌دهم» or «از همین‌جا شروع کن» (PRD §11.1, §11.2); the next screen comes back. */
export async function placementStep(language: string, input: PlacementInput, shown: { part: string; number: number } | null): Promise<PlacementScreen | null> {
  const user = await signedIn();
  if (!isLanguage(language)) return null;
  const screen = await placementInput(user, language, input, shown);
  if (screen?.kind === "done") revalidatePath(`/learn/${language}`, "layout");
  return screen;
}

/** «از همین‌جا شروع کن» on the home (PRD §11.1): the test ends as «ادامه نمی‌دهم» and the home opens. */
export async function startFromHere(language: string) {
  const user = await signedIn();
  if (!isLanguage(language)) return;
  await placementInput(user, language, { stop: true }, null);
  redirect(`/learn/${language}/placement`);
}

const isSkill = (value: string): value is SkillName => (EXAM_SKILLS as readonly string[]).includes(value);

/** «شروع آزمون» on the exam's first page (PRD §11.6): the exam, or the one half-way; its first screen comes back. */
export async function beginSkillExam(language: string, skill: string): Promise<ExamScreen | null> {
  const user = await signedIn();
  if (!isLanguage(language) || !isSkill(skill)) return null;
  const started = await beginExam(user, language, skill);
  if (started === "unavailable") return null;
  return examScreen(user, language, skill);
}

/** One answer of a level exam; the next screen, or the result, comes back (PRD §11.6). */
export async function examStep(language: string, skill: string, input: ExamInput, number: number): Promise<ExamScreen | null> {
  const user = await signedIn();
  if (!isLanguage(language) || !isSkill(skill)) return null;
  const screen = await examInput(user, language, skill, input, number);
  if (screen?.kind === "done") revalidatePath(`/learn/${language}`, "layout");
  return screen;
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

/** «زمان را جلو ببر», tester accounts only: the next session sees this account N days later. */
export async function moveMyTime(language: string, days: number) {
  const user = await signedIn();
  if (!isLanguage(language) || (!user.is_tester && !user.is_admin)) return;
  if (!(TRAVEL_DAYS as readonly number[]).includes(days)) return;
  await travelDays(user, language, days);
  revalidatePath(`/learn/${language}`, "layout");
}

export async function signOutLearner() {
  await endSession();
  redirect("/login");
}
