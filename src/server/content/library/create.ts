import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { backupTables, prismaQuerier, quote, rowSelect, type BackupTable } from "@/server/backup/tables";
import { cleanText } from "@/lib/clean-text";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { fold } from "@/engine/tokens";
import { freeCode, repeatedWord, senseCode } from "../codes";
import { lastIntroOrder } from "../intro-order";
import { checkTarget, sentenceHash, tidy, blankHoldsWord, type TargetInput } from "../kinds/sentence-store";
import { describeProblem } from "../problems";
import { topLevel } from "../sentence-level";
import { loadVocabulary } from "../vocabulary";
import { mapForEdit, suggestTokens } from "./edit/tokens";
import type { FieldError } from "./edit/types";
import { logChange } from "./log";
import { copyableSlugs, entityOf, type LibrarySlug } from "./slugs";

/**
 * Making items by hand, without a chatbot (owner's choice, DECISIONS.md): a word or phrase from a short
 * form, a practice sentence with its blank, and «کپی از این مورد» for the types whose copy stands on its
 * own. Each new item is a draft and goes through «بازبینی» and «انتشار» like any other.
 */

export type AddResult = { state: "added"; id: number } | { state: "exists"; id: number } | { state: "invalid"; errors: FieldError[] };

const posValues = ["noun", "verb", "adj", "adv", "prep", "pron", "det", "conj", "num", "interj", "phrase"] as const;
const genders: Record<string, string[]> = { fr: ["m", "f", "mf"], de: ["der", "die", "das"] };

const wordInput = z.object({
  lemma: z.string().transform((value) => tidy(cleanText(value))).pipe(z.string().min(1).max(80)),
  pos: z.enum(posValues),
  level: z.string(),
  meaning_fa: z.string().transform((value) => cleanText(value).trim()).optional(),
  gender: z.string().optional(),
});

const fieldError = (path: string, message: string): FieldError => ({ path, message });

/** A new word or phrase as a draft at the end of its level's order; P-W or the form fills the rest. */
export async function addWord(language: string, raw: unknown, adminId: number): Promise<AddResult> {
  const parsed = wordInput.safeParse(raw);
  if (!parsed.success) return { state: "invalid", errors: parsed.error.issues.map((issue) => fieldError(String(issue.path[0] ?? "lemma"), describeProblem({ key: "missing", vars: { field: String(issue.path[0] ?? "lemma") } }))) };
  const input = parsed.data;
  const levels = await appSetting<string[]>(`levels.${language}`);
  if (!levels.includes(input.level)) return { state: "invalid", errors: [fieldError("level", describeProblem({ key: "missing", vars: { field: "level" } }))] };
  const gender = input.pos === "noun" && input.gender && genders[language]?.includes(input.gender) ? input.gender : null;

  return db.$transaction(async (tx) => {
    const existing = await tx.word.findMany({ where: { language }, select: { id: true, code: true, lemma: true, pos: true, gender: true, status: true } });
    const same = repeatedWord(existing, { lemma: input.lemma, pos: input.pos, gender });
    if (same) return { state: "exists" as const, id: same.id };
    const taken = new Set(existing.map((word) => word.code));
    const word = await tx.word.create({
      data: {
        language,
        code: freeCode(input.lemma, input.pos, taken),
        lemma: input.lemma,
        pos: input.pos,
        gender: gender as never,
        number: input.pos === "noun" ? "sg" : null,
        level: input.level,
        meaning_fa: input.meaning_fa || null,
        intro_order: (await lastIntroOrder(tx, language, input.level)) + 1,
        parts: [],
        homophones: [],
      },
    });
    await logChange(tx, adminId, { action: "add", entity: "word", entityId: word.id, before: null, after: { by_hand: true, lemma: word.lemma, pos: word.pos, level: word.level } });
    return { state: "added" as const, id: word.id };
  });
}

const sentenceInput = z.object({
  text: z.string().transform((value) => tidy(cleanText(value))).pipe(z.string().min(1).max(300)),
  translation_fa: z.string().transform((value) => cleanText(value).trim()).pipe(z.string().min(1).max(400)),
  /** Code of the word the blank is for; empty for a sentence without a blank. */
  target: z.string().trim().optional(),
  distractors: z.array(z.string().transform((value) => tidy(cleanText(value)))).optional(),
});

/**
 * A new sentence: its words are matched to the list the way the edit form suggests them (candidates where
 * no list word fits), and with a target word, one blank on that word with the teacher's three wrong options.
 */
export async function addSentence(language: string, raw: unknown, adminId: number): Promise<AddResult> {
  const parsed = sentenceInput.safeParse(raw);
  if (!parsed.success) {
    return { state: "invalid", errors: parsed.error.issues.map((issue) => fieldError(String(issue.path[0] ?? "text"), describeProblem({ key: "missing", vars: { field: String(issue.path[0] ?? "text") } }))) };
  }
  const input = parsed.data;
  const hash = sentenceHash(input.text);
  const twin = await db.sentence.findUnique({ where: { language_text_hash: { language, text_hash: hash } }, select: { id: true } });
  if (twin) return { state: "exists", id: twin.id };

  const vocabulary = await loadVocabulary(db, language);
  const entry = input.target ? vocabulary.byCode(input.target) : undefined;
  const target = entry ? vocabulary.byId(entry.id) : undefined;
  if (input.target && !target) return { state: "invalid", errors: [fieldError("target", describeProblem({ key: "missing", vars: { field: "target" } }))] };
  const suggested = await suggestTokens(language, input.text, []);
  // The target word is what the teacher chose, wherever the guess was unsure.
  const tokens = suggested.tokens.map((token) =>
    target && token.kind === "word" && !token.code && fold(token.surface) === fold(target.lemma) ? { ...token, code: target.code } : token,
  );
  const mapped = mapForEdit(input.text, tokens, vocabulary);
  if ("errors" in mapped) return { state: "invalid", errors: mapped.errors.map((error) => ({ ...error, path: "text" })) };
  const rows = mapped.rows;

  let targetRow: TargetInput | null = null;
  if (target) {
    const row = rows.find((item) => item.word_id === target.id);
    if (!row) return { state: "invalid", errors: [fieldError("target", t_notInSentence(target.lemma))] };
    const [start, end] = row.spans[0];
    const marked = `${input.text.slice(0, start)}{{${input.text.slice(start, end)}}}${input.text.slice(end)}`;
    const distractors = (input.distractors ?? []).filter(Boolean);
    targetRow = { marked_text: marked, blanks: 1, accepted: [input.text.slice(start, end)], distractors, hint: null, accepted_full: null };
    const problems = checkTarget(targetRow, input.text, "target");
    if (problems.length) return { state: "invalid", errors: problems.map((item) => fieldError("distractors", describeProblem(item))) };
    if (!blankHoldsWord(marked, input.text, rows, target.id)) return { state: "invalid", errors: [fieldError("target", t_notInSentence(target.lemma))] };
  }

  return db.$transaction(async (tx) => {
    const level = topLevel(rows.filter((row) => row.kind === "word").map((row) => (row.word_id ? vocabulary.byId(row.word_id)?.level : null))) ?? target?.level ?? null;
    const sentence = await tx.sentence.create({
      data: {
        language,
        text: input.text,
        translation_fa: input.translation_fa,
        text_hash: hash,
        level,
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
    if (target && targetRow) {
      await tx.sentenceTarget.create({
        data: {
          language,
          sentence_id: sentence.id,
          target_type: "word",
          target_id: target.id,
          marked_text: targetRow.marked_text,
          blanks: 1,
          accepted: targetRow.accepted as Prisma.InputJsonValue,
          distractors: targetRow.distractors as Prisma.InputJsonValue,
        },
      });
    }
    await logChange(tx, adminId, { action: "add", entity: "sentence", entityId: sentence.id, before: null, after: { by_hand: true, text: sentence.text } });
    return { state: "added" as const, id: sentence.id };
  });
}

function t_notInSentence(lemma: string) {
  return describeProblem({ key: "targetNotInSentence", vars: { lemma } });
}


const AUDIO_KEY = /audio_id$/;
/** Takes stored audio out of a JSON column's objects: a copy has no recordings of its own yet. */
function withoutAudio(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAudio);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, AUDIO_KEY.test(key) ? null : withoutAudio(inner)]));
  }
  return value;
}

/** Inserts one row (as `rowSelect` writes it) without its id, so it gets a new one. */
async function insertCopy(tx: Prisma.TransactionClient, table: BackupTable, row: Record<string, unknown>): Promise<number> {
  const columns = table.columns.filter((column) => column.name !== "id");
  const names = columns.map((column) => quote(column.name)).join(", ");
  const values = columns.map((column) => (column.json ? `r.${quote(column.name)}::${column.type}` : `r.${quote(column.name)}`)).join(", ");
  const shape = columns.map((column) => `${quote(column.name)} ${column.json ? "text" : column.type}`).join(", ");
  const inserted = await tx.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO ${quote(table.name)} (${names}) SELECT ${values} FROM jsonb_to_recordset($1::jsonb) AS r(${shape}) RETURNING id`,
    JSON.stringify([row]),
  );
  return inserted[0].id;
}

export type CopyResult = { state: "copied"; id: number } | { state: "gone" } | { state: "unsupported" };

/**
 * «کپی از این مورد»: a new draft with the same content, its own code, no audio and no review history.
 * A copied word is a new sense of the original (PRD §13.9, «glace-2»); a copied unit gets its own
 * code and no example sentences; everything else is copied as it is.
 */
export async function copyItem(slug: LibrarySlug, id: number, adminId: number): Promise<CopyResult> {
  if (!copyableSlugs.includes(slug)) return { state: "unsupported" };
  const name = entityOf[slug];
  return db.$transaction(async (tx) => {
    const table = (await backupTables(prismaQuerier(tx))).find((item) => item.name === name)!;
    const found = await tx.$queryRawUnsafe<{ row: string }[]>(`SELECT ${rowSelect(table)} AS row FROM ${quote(name)} t WHERE t.id = $1`, id);
    if (found.length === 0) return { state: "gone" as const };
    const row = JSON.parse(found[0].row) as Record<string, unknown>;
    const now = new Date().toISOString();
    const reset: Record<string, unknown> = {
      status: "draft",
      suspended: false,
      import_batch_id: null,
      prompt_version: null,
      model_name: null,
      created_at: now,
      updated_at: now,
    };
    if ("audio_id" in row) reset.audio_id = null;
    if ("human_audio_id" in row) reset.human_audio_id = null;
    if ("order_no" in row) reset.order_no = null;
    for (const column of table.columns) {
      if (column.json && typeof row[column.name] === "string") reset[column.name] = JSON.stringify(withoutAudio(JSON.parse(row[column.name] as string)));
    }

    const language = row.language as string;
    if (slug === "words") {
      const taken = new Set((await tx.word.findMany({ where: { language }, select: { code: true } })).map((word) => word.code));
      Object.assign(reset, {
        code: senseCode(row.lemma as string, taken),
        sense_of: (row.sense_of as string | null) ?? row.code,
        intro_order: (await lastIntroOrder(tx, language, row.level as string)) + 1,
        dup_of_id: null,
        concept_id: null,
        mastery_manual: false,
      });
    }
    if (slug === "units") {
      const codes = new Set((await tx.grammarUnit.findMany({ select: { unit_code: true } })).map((unit) => unit.unit_code));
      let n = 2;
      while (codes.has(`${row.unit_code}-${n}`)) n++;
      Object.assign(reset, { unit_code: `${row.unit_code}-${n}`, example_sentence_ids: [], title_fa: `${row.title_fa} (۲)` });
    }
    if (slug === "phonics") reset.sound_label = `${row.sound_label} (۲)`;

    const copyId = await insertCopy(tx, table, { ...row, ...reset });
    await logChange(tx, adminId, { action: "add", entity: name, entityId: copyId, before: null, after: { copied_from: id } });
    return { state: "copied" as const, id: copyId };
  });
}
