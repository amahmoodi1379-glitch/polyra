"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import {
  resolveCandidate,
  resolveDuplicate,
  resolveSuspect,
  searchVocabulary,
  type CandidateAction,
  type SuspectAction,
  type WordRef,
} from "@/server/content/resolve";
import { logError } from "@/server/errors";

/** "done": settled. "gone": someone settled it already or the input was wrong. "failed": an error, logged. */
export type ResolveOutcome = "done" | "gone" | "failed";

async function run(where: string, work: () => Promise<boolean>): Promise<ResolveOutcome> {
  const admin = await requireAdmin();
  try {
    const done = await work();
    revalidatePath("/admin", "layout");
    return done ? "done" : "gone";
  } catch (error) {
    await logError(where, error, { userId: admin.id });
    return "failed";
  }
}

export async function settleCandidate(language: string, key: string, action: CandidateAction) {
  if (!isLanguage(language)) return "gone" as const;
  return run("resolve.candidate", () => resolveCandidate(language, key, action));
}

export async function settleSuspect(language: string, key: string, action: SuspectAction) {
  if (!isLanguage(language)) return "gone" as const;
  return run("resolve.suspect", () => resolveSuspect(language, key, action));
}

export async function settleDuplicate(language: string, wordId: number, isNewSense: boolean) {
  if (!isLanguage(language)) return "gone" as const;
  return run("resolve.duplicate", () => resolveDuplicate(language, wordId, isNewSense));
}

export async function findWords(language: string, query: string): Promise<WordRef[]> {
  await requireAdmin();
  if (!isLanguage(language)) return [];
  return searchVocabulary(language, query.slice(0, 60));
}
