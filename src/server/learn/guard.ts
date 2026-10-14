import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { isLanguage, type LanguageCode } from "@/server/content/languages";
import { enrollments } from "./enroll";

/** The language whose home the learner saw last, so the app opens there next time. */
export const LANGUAGE_COOKIE = "polyra_lang";

/** For learner pages: the signed-in user, or the login page that comes back here. */
export async function requireLearner(path: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  return user;
}

/** A language code from the address, or the 404 page. */
export function languageParam(value: string): LanguageCode | null {
  return isLanguage(value) ? value : null;
}

/** Where «/» goes: the last language's home, the first enrollment's, or the start of the app (PRD §3.1). */
export async function entryPath(userId: number): Promise<string> {
  const rows = await enrollments(userId);
  if (rows.length === 0) return "/start";
  const last = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  const language = rows.find((row) => row.language === last)?.language ?? rows[0].language;
  return `/learn/${language}`;
}
