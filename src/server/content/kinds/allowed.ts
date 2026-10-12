import { db } from "@/server/db";
import { levelRank } from "../languages";
import { lines } from "./shared";

/** Above this many allowed words the meanings are left out so the prompt fits (PRD §14.9). */
const LIST_WITH_MEANINGS = 600;

/**
 * The «فهرست مجاز» of a prompt (PRD §14.9), one "code | pos | meaning" line per word: either the first
 * `first` words of the teaching order plus the no_card words, or every word of `level` and below.
 */
export async function allowedWords(language: string, scope: { first: number } | { level: string }) {
  const words = await db.word.findMany({
    where: { language, status: { not: "retired" }, dup_of_id: null },
    select: { code: true, pos: true, meaning_fa: true, level: true, intro_order: true, no_card: true, register: true },
  });
  let allowed: typeof words;
  if ("first" in scope) {
    const ordered = words
      .filter((word) => !word.no_card && word.register === "standard")
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9));
    allowed = [...ordered.slice(0, scope.first), ...words.filter((word) => word.no_card)];
  } else {
    allowed = words.filter((word) => levelRank(word.level) <= levelRank(scope.level));
  }
  const withMeaning = allowed.length <= LIST_WITH_MEANINGS;
  return lines(allowed.map((word) => [word.code, word.pos, ...(withMeaning ? [word.meaning_fa ?? "—"] : [])].join(" | ")));
}
