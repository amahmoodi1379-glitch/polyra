import { createHash } from "node:crypto";
import type { ImportBatch, Prisma } from "@/generated/prisma/client";
import { checkTokens, fold, type MappedRow, type TokenProblem } from "@/engine/tokens";
import type { Token } from "@/schemas/common";
import { levelRank } from "../languages";
import { problem, type Problem } from "../problems";
import type { Flag, RoundResult } from "../report";
import type { LoadedVocabulary } from "../vocabulary";
import { trace } from "./shared";
import type { Tx } from "./types";

/**
 * Sentences and fill-in targets as every importer stores them (PRD §14.1, §14.2): the word mapping
 * check, one sentence per text (PRD §14.9), and the blank rules of a target (PRD §13.3).
 */

const MAX_SENTENCE = 200;
const MAX_OPTION = 80;
const OUT_OF_LIST_SHARE = 0.1;

export type SentenceInput = { text: string; tts_text: string | null; translation_fa: string; tokens: Token[] };

export type TargetInput = {
  marked_text: string;
  blanks: 1 | 2;
  accepted: (string | string[])[];
  distractors: (string | string[])[];
  hint: string | null;
  accepted_full: string[] | null;
};

/** Same sentence = same text after tidying spaces, apostrophes and case (PRD §14.9). */
export function sentenceHash(text: string) {
  const clean = fold(text).replace(/\s+/g, " ").trim();
  return createHash("sha256").update(clean).digest("hex");
}

const blankPattern = /\{\{(.*?)\}\}/g;
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
export const tidy = (text: string) => text.normalize("NFC").replace(/[’ʼ]/g, "'").replace(/\s+/g, " ").trim();

function tokenProblem(item: TokenProblem): Problem {
  switch (item.type) {
    case "not_found":
      return problem("tokenNotFound", { surface: item.surface });
    case "uncovered":
      return problem("tokenUncovered", { piece: item.piece });
    case "name_not_capital":
      return problem("nameNotCapital", { surface: item.surface });
    case "number_without_digit":
      return problem("numberWithoutDigit", { surface: item.surface });
  }
}

/** The word mapping of one sentence (PRD §14.1): its rows, or why it cannot be stored. */
export function mapSentence(sentence: Pick<SentenceInput, "text" | "tokens">, vocabulary: LoadedVocabulary) {
  const mapping = checkTokens(sentence.text, sentence.tokens, vocabulary);
  return mapping.ok ? { rows: mapping.rows, problems: [] as Problem[] } : { rows: null, problems: mapping.problems.map(tokenProblem) };
}

/** Blank rules of one target (PRD §13.3 "هدف جمله"). */
export function checkTarget(target: TargetInput, text: string, path: string): Problem[] {
  const problems: Problem[] = [];
  const at = (name: string) => (path ? `${path}.${name}` : name);
  const blanks = [...target.marked_text.matchAll(blankPattern)].map((match) => match[1].trim());
  if (blanks.length !== target.blanks) {
    problems.push(problem("blanksCount", { field: at("marked_text"), found: blanks.length, expected: target.blanks }));
    return problems;
  }
  if (tidy(target.marked_text.replace(blankPattern, "$1")) !== tidy(text)) {
    problems.push(problem("markedTextMismatch", { field: at("marked_text") }));
  }
  // One blank: flat lists. Two blanks: a list per blank.
  const acceptedPerBlank = target.blanks === 1 ? [target.accepted] : target.accepted;
  const distractorsPerBlank = target.blanks === 1 ? [target.distractors] : target.distractors;
  blanks.forEach((blank, index) => {
    const accepted = acceptedPerBlank[index];
    const distractors = distractorsPerBlank[index];
    const suffix = target.blanks === 1 ? "" : `[${index}]`;
    if (!isStrings(accepted)) {
      problems.push(problem("wrongType", { field: at(`accepted${suffix}`) }));
      return;
    }
    if (!isStrings(distractors)) {
      problems.push(problem("wrongType", { field: at(`distractors${suffix}`) }));
      return;
    }
    const acceptedSet = new Set(accepted.map((value) => fold(value.trim())));
    if (!acceptedSet.has(fold(blank))) problems.push(problem("blankNotAccepted", { text: blank, field: at(`accepted${suffix}`) }));
    if (distractors.length !== 3) problems.push(problem("distractorsCount", { field: at(`distractors${suffix}`) }));
    const folded = distractors.map((value) => fold(value.trim()));
    if (new Set(folded).size !== folded.length) problems.push(problem("distractorsRepeat", { field: at(`distractors${suffix}`) }));
    for (const [k, value] of folded.entries()) {
      if (acceptedSet.has(value)) problems.push(problem("distractorAccepted", { value: distractors[k], field: at(`distractors${suffix}`) }));
    }
  });
  return problems;
}

/** Length warnings (PRD §13.3 "همه"). */
export function lengthFlags(text: string, targets: TargetInput[], label: string): Flag[] {
  const flags: Flag[] = [];
  if (text.length > MAX_SENTENCE) flags.push({ label, problem: problem("tooLong", { field: "text", max: MAX_SENTENCE }) });
  for (const target of targets) {
    const options = [...target.accepted, ...target.distractors].flat();
    if (options.some((option) => option.length > MAX_OPTION)) {
      flags.push({ label, problem: problem("tooLong", { field: "distractors", max: MAX_OPTION }) });
      break;
    }
  }
  return flags;
}

/**
 * Stores a sentence whose mapping passed, or finds the same sentence already stored (it is never made
 * twice, PRD §14.9). Candidates and suspects are counted in the round; words above the batch level
 * or outside the list give a warning.
 */
export async function storeSentence(
  tx: Tx,
  batch: ImportBatch,
  input: { sentence: SentenceInput; rows: MappedRow[]; vocabulary: LoadedVocabulary; level: string; label: string },
  round: RoundResult,
  seenInAnswer: Map<string, number>,
): Promise<{ id: number; isNew: boolean }> {
  const { sentence, rows, vocabulary, level, label } = input;
  const language = batch.language;
  const hash = sentenceHash(sentence.text);
  const existingId =
    seenInAnswer.get(hash) ??
    (await tx.sentence.findUnique({ where: { language_text_hash: { language, text_hash: hash } }, select: { id: true } }))?.id;
  if (existingId) {
    seenInAnswer.set(hash, existingId);
    return { id: existingId, isNew: false };
  }

  const wordRows = rows.filter((row) => row.kind === "word");
  const levels = wordRows.map((row) => (row.word_id ? vocabulary.byId(row.word_id)?.level : null)).filter(Boolean) as string[];
  const outside = wordRows.filter((row) => {
    const word = row.word_id ? vocabulary.byId(row.word_id) : undefined;
    return !word || levelRank(word.level) > levelRank(level);
  }).length;
  if (wordRows.length > 0 && outside / wordRows.length >= OUT_OF_LIST_SHARE) {
    round.warnings.push({ label, problem: problem("outOfList", { share: Math.round((100 * outside) / wordRows.length) }) });
  }
  const created = await tx.sentence.create({
    data: {
      language,
      text: sentence.text,
      tts_text: sentence.tts_text,
      translation_fa: sentence.translation_fa,
      text_hash: hash,
      level: levels.reduce<string | null>((top, value) => (top && levelRank(top) >= levelRank(value) ? top : value), null),
      ...trace(batch),
      words: {
        create: rows.map((row) => ({
          position: row.position,
          kind: row.kind,
          word_id: row.word_id,
          surface: row.surface,
          spans: row.spans,
          meaning_fa_ctx: row.meaning_fa_ctx,
          suspect: row.suspect,
          code_given: row.code_given,
          candidate_reason: row.candidate_reason,
        })),
      },
    },
  });
  round.candidates += rows.filter((row) => row.candidate_reason).length;
  round.suspects += rows.filter((row) => row.suspect).length;
  seenInAnswer.set(hash, created.id);
  return { id: created.id, isNew: true };
}

/** Adds the targets a sentence does not have yet; the same blank for the same target is kept once. */
export async function addTargets(
  tx: Tx,
  batch: ImportBatch,
  sentenceId: number,
  targets: { type: "word" | "grammar"; id: number; target: TargetInput }[],
) {
  const present = await tx.sentenceTarget.findMany({
    where: { sentence_id: sentenceId },
    select: { target_type: true, target_id: true, marked_text: true },
  });
  const has = new Set(present.map((row) => `${row.target_type}|${row.target_id}|${tidy(row.marked_text)}`));
  let added = 0;
  for (const { type, id, target } of targets) {
    const key = `${type}|${id}|${tidy(target.marked_text)}`;
    if (has.has(key)) continue;
    has.add(key);
    added++;
    await tx.sentenceTarget.create({
      data: {
        language: batch.language,
        sentence_id: sentenceId,
        target_type: type,
        target_id: id,
        marked_text: target.marked_text,
        blanks: target.blanks,
        accepted: target.accepted as Prisma.InputJsonValue,
        distractors: target.distractors as Prisma.InputJsonValue,
        hint: target.hint,
        accepted_full: (target.accepted_full ?? undefined) as Prisma.InputJsonValue | undefined,
        ...trace(batch),
      },
    });
  }
  return added;
}
