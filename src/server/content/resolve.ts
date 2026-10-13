import type { Pos } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { posValues } from "@/schemas/common";
import { freeCode, readCode, senseCode } from "./codes";
import { lastIntroOrder, placeAfter } from "./intro-order";
import { refreshDifficulty } from "./text-difficulty";
import type { Tx } from "./kinds/types";

/**
 * The open items a sentence or word import leaves for the admin (PRD §13.3, §13.9): candidates (a
 * word that is not in the vocabulary, or a name that equals a vocabulary word), suspect mappings,
 * and words imported with a lemma that already exists. Each is solved with one button; nothing here
 * asks the admin to type a code.
 *
 * The same word usually turns up in many sentences, so rows are grouped: a candidate by its code,
 * a suspect by its word and surface. One decision settles the whole group.
 */

export type SentenceRef = { id: number; text: string; translation_fa: string; spans: [number, number][] };
export type WordRef = { id: number; code: string; lemma: string; pos: Pos; meaning_fa: string | null; level: string };

export type CandidateGroup = {
  key: string;
  reason: "missing" | "name_matches_word";
  /** What the chatbot called it: the lemma from its code for a missing word, the surface for a name. */
  word: string;
  /** Word type the chatbot's code names, if any; a starting point for "add to the list". */
  pos: Pos | null;
  surface: string;
  /** Meaning in the sentence, from the chatbot. */
  meaning: string | null;
  /** Level a new word gets unless the admin picks another: the sentence's level. */
  level: string;
  sentences: number;
  sentence: SentenceRef;
  /** For a name that equals a vocabulary word: that word. */
  match: WordRef | null;
};

export type SuspectGroup = { key: string; surface: string; word: WordRef; sentences: number; sentence: SentenceRef };
export type DuplicatePair = { word: WordRef; existing: WordRef };
export type OpenItems = { candidates: CandidateGroup[]; suspects: SuspectGroup[]; duplicates: DuplicatePair[] };

const wordFields = { id: true, code: true, lemma: true, pos: true, meaning_fa: true, level: true } as const;

async function openRows(tx: Tx, language: string) {
  return tx.sentenceWord.findMany({
    where: {
      sentence: { language, status: { not: "retired" } },
      OR: [{ candidate_reason: { not: null } }, { suspect: true }],
    },
    include: { sentence: { select: { id: true, text: true, translation_fa: true, level: true } }, word: { select: wordFields } },
    orderBy: [{ sentence_id: "asc" }, { position: "asc" }],
  });
}
type OpenRow = Awaited<ReturnType<typeof openRows>>[number];

type KeyFields = Pick<OpenRow, "candidate_reason" | "code_given" | "surface" | "word_id">;
const candidateKey = (row: KeyFields) => `${row.candidate_reason}|${fold(row.code_given ?? row.surface)}`;
const suspectKey = (row: KeyFields) => `${row.word_id}|${fold(row.surface)}`;

function sentenceRef(row: OpenRow): SentenceRef {
  return { ...row.sentence, spans: row.spans as [number, number][] };
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

/** Vocabulary words a name could really be: the same lemma or plural. */
async function wordsNamed(tx: Tx, language: string, surfaces: string[]) {
  if (surfaces.length === 0) return new Map<string, WordRef>();
  const words = await tx.word.findMany({
    where: { language, status: { not: "retired" }, dup_of_id: null },
    select: { ...wordFields, plural: true },
  });
  const wanted = new Set(surfaces.map(fold));
  const found = new Map<string, WordRef>();
  for (const { plural, ...word } of words) {
    for (const form of [word.lemma, plural]) {
      if (form && wanted.has(fold(form)) && !found.has(fold(form))) found.set(fold(form), word);
    }
  }
  return found;
}

export async function openItems(language: string): Promise<OpenItems> {
  const rows = await openRows(db, language);
  const levels = await appSetting<string[]>(`levels.${language}`);

  const candidateRows = rows.filter((row) => row.candidate_reason);
  const names = await wordsNamed(
    db,
    language,
    candidateRows.filter((row) => row.candidate_reason === "name_matches_word").map((row) => row.surface),
  );
  const candidates = [...groupBy(candidateRows, candidateKey)].map(([key, group]): CandidateGroup => {
    const first = group[0];
    const reason = first.candidate_reason!;
    const given = reason === "missing" && first.code_given ? readCode(first.code_given, posValues) : null;
    return {
      key,
      reason,
      word: given?.lemma ?? first.surface,
      pos: (given?.pos as Pos | null) ?? null,
      surface: first.surface,
      meaning: first.meaning_fa_ctx,
      level: first.sentence.level && levels.includes(first.sentence.level) ? first.sentence.level : levels[0],
      sentences: new Set(group.map((row) => row.sentence_id)).size,
      sentence: sentenceRef(first),
      match: reason === "name_matches_word" ? (names.get(fold(first.surface)) ?? null) : null,
    };
  });

  const suspects = [...groupBy(rows.filter((row) => row.suspect && row.word), suspectKey)].map(
    ([key, group]): SuspectGroup => ({
      key,
      surface: group[0].surface,
      word: group[0].word!,
      sentences: new Set(group.map((row) => row.sentence_id)).size,
      sentence: sentenceRef(group[0]),
    }),
  );

  const dups = await db.word.findMany({
    where: { language, dup_of_id: { not: null }, status: { not: "retired" } },
    select: { ...wordFields, dup_of_id: true },
    orderBy: { id: "asc" },
  });
  const originals = new Map(
    (await db.word.findMany({ where: { id: { in: dups.map((dup) => dup.dup_of_id!) } }, select: wordFields })).map((word) => [
      word.id,
      word,
    ]),
  );
  const duplicates = dups.flatMap(({ dup_of_id, ...word }) => {
    const existing = originals.get(dup_of_id!);
    return existing ? [{ word, existing }] : [];
  });

  return { candidates, suspects, duplicates };
}

/** How many items are open, counted the way the resolve page groups them: for the workbench and the batch report. */
export async function openCounts(language: string, importBatchId?: number) {
  const sentence = { language, status: { not: "retired" as const }, ...(importBatchId ? { import_batch_id: importBatchId } : {}) };
  const [rows, duplicates] = await Promise.all([
    db.sentenceWord.findMany({
      where: { sentence, OR: [{ candidate_reason: { not: null } }, { suspect: true }] },
      select: { candidate_reason: true, code_given: true, surface: true, word_id: true, suspect: true },
    }),
    db.word.count({
      where: { language, dup_of_id: { not: null }, status: { not: "retired" }, ...(importBatchId ? { import_batch_id: importBatchId } : {}) },
    }),
  ]);
  return {
    candidates: new Set(rows.filter((row) => row.candidate_reason).map(candidateKey)).size,
    suspects: new Set(rows.filter((row) => row.suspect && row.word_id).map(suspectKey)).size,
    duplicates,
  };
}

/** Remembers that this surface is a form of this word, so the check never asks again (PRD §14.1 rule 6). */
async function confirmForm(tx: Tx, wordId: number, surface: string, lemma: string) {
  const form = fold(surface);
  if (form === fold(lemma)) return;
  await tx.formException.upsert({
    where: { word_id_surface: { word_id: wordId, surface: form } },
    create: { word_id: wordId, surface: form },
    update: {},
  });
}

/** Links every row of a group to a word and clears its marks. */
async function linkRows(tx: Tx, rows: OpenRow[], word: { id: number; lemma: string }) {
  await tx.sentenceWord.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { kind: "word", word_id: word.id, candidate_reason: null, suspect: false },
  });
  for (const surface of new Set(rows.map((row) => row.surface))) await confirmForm(tx, word.id, surface, word.lemma);
  await refreshDifficulty(tx, { sentenceIds: rows.map((row) => row.sentence_id) });
}

async function findWord(tx: Tx, language: string, id: number) {
  return tx.word.findFirst({ where: { id, language, status: { not: "retired" } }, select: wordFields });
}

export type CandidateAction =
  | { type: "add"; lemma: string; pos: Pos; level: string }
  | { type: "choose"; wordId: number }
  | { type: "name" }
  | { type: "listed" };

/** Settles one candidate group. Returns false when the group is already settled or the input is wrong. */
export async function resolveCandidate(language: string, key: string, action: CandidateAction): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const rows = (await openRows(tx, language)).filter((row) => row.candidate_reason && candidateKey(row) === key);
    if (rows.length === 0) return false;

    if (action.type === "name") {
      await tx.sentenceWord.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { kind: "name", word_id: null, candidate_reason: null, suspect: false },
      });
      await refreshDifficulty(tx, { sentenceIds: rows.map((row) => row.sentence_id) });
      return true;
    }
    if (action.type === "listed") {
      const match = (await wordsNamed(tx, language, [rows[0].surface])).get(fold(rows[0].surface));
      if (!match) return false;
      await linkRows(tx, rows, match);
      return true;
    }
    if (action.type === "choose") {
      const word = await findWord(tx, language, action.wordId);
      if (!word) return false;
      await linkRows(tx, rows, word);
      return true;
    }

    // "Add to the list": a draft word that the next word batch (P-W) fills in.
    const lemma = action.lemma.trim().slice(0, 80);
    const levels = await appSetting<string[]>(`levels.${language}`);
    if (!lemma || !levels.includes(action.level) || !posValues.includes(action.pos)) return false;
    const existing = await tx.word.findMany({ where: { language }, select: { id: true, code: true, lemma: true, pos: true, status: true } });
    const same = existing.find((word) => word.status !== "retired" && word.pos === action.pos && fold(word.lemma) === fold(lemma));
    if (same) {
      await linkRows(tx, rows, same);
      return true;
    }
    const rank = await tx.frequencyItem.findFirst({ where: { language, lemma }, select: { rank: true } });
    const word = await tx.word.create({
      data: {
        language,
        code: freeCode(lemma, action.pos, new Set(existing.map((word) => word.code))),
        lemma,
        pos: action.pos,
        level: action.level,
        intro_order: (await lastIntroOrder(tx, language, action.level)) + 1,
        frequency_rank: rank?.rank ?? null,
      },
    });
    await linkRows(tx, rows, word);
    return true;
  });
}

export type SuspectAction = { type: "confirm" } | { type: "choose"; wordId: number };

/** Settles one suspect group: the mapping is right (remembered), or another word is the right one. */
export async function resolveSuspect(language: string, key: string, action: SuspectAction): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const rows = (await openRows(tx, language)).filter((row) => row.suspect && suspectKey(row) === key);
    if (rows.length === 0 || !rows[0].word) return false;
    const word = action.type === "confirm" ? rows[0].word : await findWord(tx, language, action.wordId);
    if (!word) return false;
    await linkRows(tx, rows, word);
    return true;
  });
}

/**
 * A word imported with a lemma that already exists (PRD §13.9). "New sense" gives it the code
 * lemma-2 and points sense_of at the existing word; "duplicate" retires it and moves anything that
 * already used it over to the existing word.
 */
export async function resolveDuplicate(language: string, wordId: number, isNewSense: boolean): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const word = await tx.word.findFirst({ where: { id: wordId, language, dup_of_id: { not: null }, status: { not: "retired" } } });
    if (!word) return false;
    const existing = await tx.word.findUnique({ where: { id: word.dup_of_id! } });
    if (!existing) return false;

    if (isNewSense) {
      const taken = new Set((await tx.word.findMany({ where: { language }, select: { code: true } })).map((row) => row.code));
      await tx.word.update({
        where: { id: word.id },
        data: { code: senseCode(existing.lemma, taken), sense_of: existing.code, dup_of_id: null },
      });
      if (word.level === existing.level) await placeAfter(tx, language, word.level, [{ wordId: word.id, afterId: existing.id }]);
      return true;
    }

    await tx.sentenceWord.updateMany({ where: { word_id: word.id }, data: { word_id: existing.id } });
    await tx.sentenceTarget.updateMany({ where: { target_type: "word", target_id: word.id }, data: { target_id: existing.id } });
    await tx.word.update({ where: { id: word.id }, data: { status: "retired", dup_of_id: null, intro_order: null } });
    await refreshDifficulty(tx, { wordIds: [existing.id] });
    return true;
  });
}

/** Vocabulary search for "choose the right word": lemma, code or meaning; exact matches first. */
export async function searchVocabulary(language: string, query: string): Promise<WordRef[]> {
  const text = query.trim();
  if (!text) return [];
  const words = await db.word.findMany({
    where: {
      language,
      status: { not: "retired" },
      dup_of_id: null,
      OR: [
        { lemma: { contains: text, mode: "insensitive" } },
        { code: { contains: text, mode: "insensitive" } },
        { meaning_fa: { contains: text } },
      ],
    },
    select: { ...wordFields, frequency_rank: true },
    take: 60,
  });
  const wanted = fold(text);
  const score = (word: (typeof words)[number]) =>
    fold(word.lemma) === wanted ? 0 : fold(word.lemma).startsWith(wanted) ? 1 : fold(word.code).startsWith(wanted) ? 2 : 3;
  return words
    .sort((a, b) => score(a) - score(b) || (a.frequency_rank ?? 1e9) - (b.frequency_rank ?? 1e9))
    .slice(0, 12)
    .map(({ id, code, lemma, pos, meaning_fa, level }) => ({ id, code, lemma, pos, meaning_fa, level }));
}
