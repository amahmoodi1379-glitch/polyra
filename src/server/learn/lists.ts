import { hasCard, type Content } from "@/engine/content";
import { wordView, type BuildEnv } from "@/engine/build";
import type { WordView } from "@/engine/ex";
import { openEntries } from "@/engine/notebook";
import { lessonView, tableView, wordCard, type LessonView, type WordCard } from "@/engine/session";
import type { NotebookRef } from "@/engine/state";
import type { LanguageCode } from "@/server/content/languages";
import { db } from "@/server/db";
import { learnerContent } from "./content";
import { notebookOf } from "./learner";
import type { Learner } from "./session";

/**
 * The learner's read-only pages (PRD §3.10): «کلمه‌های من», «درسنامه‌های من» and the mistakes
 * notebook. Only what the learner has met is listed; nothing here starts a scored exercise.
 */

const audienceOf = (user: Learner) => (user.is_admin || user.is_tester ? "tester" : "public");

async function contentFor(user: Learner, language: LanguageCode) {
  return learnerContent(language, audienceOf(user));
}

async function states(userId: number, language: string, type: "word" | "grammar_unit") {
  return db.itemState.findMany({ where: { user_id: userId, language, item_type: type }, select: { item_id: true, step: true, introduced_at: true, id: true } });
}

/** The few things `wordCard` and `lessonView` read from a build environment. */
function viewEnv(content: Content, introduced: Set<number>): BuildEnv {
  const known = (wordId: number) => introduced.has(wordId) || !!content.words.get(wordId)?.noCard;
  return { content, known, introduced } as unknown as BuildEnv;
}

export type MyWord = { id: number; word: WordView; step: number };

/** Words the learner has a card for, newest first (PRD §3.10). */
export async function myWords(user: Learner, language: LanguageCode): Promise<MyWord[]> {
  const [content, rows] = await Promise.all([contentFor(user, language), states(user.id, language, "word")]);
  return rows
    .sort((a, b) => (b.introduced_at?.getTime() ?? 0) - (a.introduced_at?.getTime() ?? 0) || b.id - a.id)
    .flatMap((row) => {
      const word = content.words.get(row.item_id);
      return word && hasCard(word) ? [{ id: word.id, word: wordView(word, content), step: row.step }] : [];
    });
}

/** One word's card: meaning, sound, an example, collocations and its verb tables (PRD §3.10). */
export async function myWord(user: Learner, language: LanguageCode, wordId: number): Promise<WordCard | null> {
  const [content, rows] = await Promise.all([contentFor(user, language), states(user.id, language, "word")]);
  const word = content.words.get(wordId);
  if (!word || !rows.some((row) => row.item_id === wordId)) return null;
  return wordCard(viewEnv(content, new Set(rows.map((row) => row.item_id))), word);
}

export type MyLesson = { id: number; title: string; canDo: string | null; order: number };

/** Grammar units opened for the learner, in teaching order (PRD §3.10). */
export async function myLessons(user: Learner, language: LanguageCode): Promise<MyLesson[]> {
  const [content, rows] = await Promise.all([contentFor(user, language), states(user.id, language, "grammar_unit")]);
  const opened = new Set(rows.map((row) => row.item_id));
  return content.units
    .filter((unit) => opened.has(unit.id))
    .sort((a, b) => a.orderNo - b.orderNo)
    .map((unit, index) => ({ id: unit.id, title: unit.titleFa, canDo: unit.canDoFa, order: index + 1 }));
}

export async function myLesson(user: Learner, language: LanguageCode, unitId: number): Promise<LessonView | null> {
  const [content, rows] = await Promise.all([contentFor(user, language), states(user.id, language, "grammar_unit")]);
  const unit = content.units.find((item) => item.id === unitId);
  if (!unit || !rows.some((row) => row.item_id === unitId)) return null;
  return lessonView(viewEnv(content, new Set()), unit);
}

export type NotebookLine = { key: string; kind: NotebookRef; target: string; article: string | null; gender: string | null; fa: string; addedAt: string; correct: number };

/** Open notebook entries, newest mistake first, each as the learner would recognise it (PRD §9.5). */
export async function notebookLines(user: Learner, language: LanguageCode, now = new Date()): Promise<NotebookLine[]> {
  const [content, rows] = await Promise.all([contentFor(user, language), db.notebookEntry.findMany({ where: { user_id: user.id, language } })]);
  const entries = openEntries(rows.map(notebookOf), now).sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
  const lines: NotebookLine[] = [];
  for (const entry of entries) {
    const base = { key: `${entry.refType}:${entry.refId}`, kind: entry.refType, addedAt: entry.addedAt, correct: entry.correctCount };
    if (entry.refType === "word" || entry.refType === "word_gender") {
      const word = content.words.get(entry.refId);
      if (!word) continue;
      const view = wordView(word, content);
      lines.push({ ...base, target: view.lemma, article: view.article, gender: view.gender, fa: view.meaning });
    } else if (entry.refType === "conjugation") {
      const table = content.conjugations.find((item) => item.id === entry.refId);
      if (!table) continue;
      const view = tableView(content, table);
      lines.push({ ...base, target: view.verb, article: null, gender: null, fa: view.tense });
    } else {
      const target = content.targets.get(entry.refId);
      const sentence = target ? content.sentences.get(target.sentenceId) : undefined;
      const unit = target ? content.units.find((item) => item.id === target.targetId) : undefined;
      if (!sentence) continue;
      lines.push({ ...base, target: sentence.text, article: null, gender: null, fa: unit?.titleFa ?? sentence.translationFa });
    }
  }
  return lines;
}
