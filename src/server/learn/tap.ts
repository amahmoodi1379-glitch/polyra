import { levelIndex } from "@/engine/content";
import { db } from "@/server/db";
import { learnerContent, type Audience } from "./content";
import type { Learner } from "./session";

/**
 * A word touched in a sentence goes once to the new-word queue (PRD §5.9): a word row, not yet
 * known to the learner (no card of it, not `no_card`, not below the learner's known level, §5.7),
 * standard register, at a published level. The learner's content holds only published levels (a
 * tester's holds every level), so the last condition is being in it.
 */
export async function queueTappedWord(user: Learner, language: string, wordId: number, now = new Date()): Promise<boolean> {
  const audience: Audience = user.is_admin || user.is_tester ? "tester" : "public";
  const content = await learnerContent(language, audience);
  const word = content.words.get(wordId);
  if (!word || word.register !== "standard" || word.noCard || !content.openLevels.includes(word.level)) return false;
  const [card, queued, enrolled, vocab] = await Promise.all([
    db.itemState.findFirst({ where: { user_id: user.id, item_type: "word", item_id: wordId }, select: { id: true } }),
    db.newWordQueue.findUnique({ where: { user_id_word_id: { user_id: user.id, word_id: wordId } }, select: { id: true } }),
    db.enrollment.findFirst({ where: { user_id: user.id, language }, select: { id: true } }),
    db.skillLevel.findFirst({ where: { user_id: user.id, language, skill: "vocab" }, select: { known_below: true } }),
  ]);
  const knownBelow = vocab?.known_below ? levelIndex(content, vocab.known_below) : -1;
  if (card || queued || !enrolled || levelIndex(content, word.level) < knownBelow) return false;
  const { count } = await db.newWordQueue.createMany({ data: [{ user_id: user.id, language, word_id: wordId, source: "tap", added_at: now }], skipDuplicates: true });
  return count > 0;
}
