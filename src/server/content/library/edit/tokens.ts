import { z } from "zod";
import { bare, fold, splitPieces, type MappedRow, type TokenInput } from "@/engine/tokens";
import { tokenKind } from "@/schemas/common";
import { db } from "@/server/db";
import { mapSentence } from "../../kinds/sentence-store";
import { describeProblem } from "../../problems";
import { loadVocabulary, type LoadedVocabulary } from "../../vocabulary";
import type { FieldError } from "./types";
import { wordInfo, type WordInfo } from "./shared";

/**
 * The word mapping of a sentence as the edit form shows it (PRD §13.7: «فرم ویرایش جدول کلمه‌های
 * جمله را هم نشان می‌دهد»): one row per word with its kind, the list word it belongs to (by code)
 * and the meaning in this sentence. Saving runs the same mapping check as import (PRD §14.1).
 */
export const tokenEdit = z.object({
  surface: z.string(),
  kind: tokenKind,
  code: z.string().nullable(),
  meaning_fa: z.string().nullable(),
});
export type TokenEdit = z.output<typeof tokenEdit>;

type StoredRow = { position?: number; kind: string; word_id: number | null; code_given: string | null; surface: string; meaning_fa_ctx: string | null };

/** Stored rows (sentence_word, or a JSON token list) back into editable rows. */
export function tokensForEdit(rows: StoredRow[], vocabulary: LoadedVocabulary): TokenEdit[] {
  return [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row) => ({
      surface: row.surface,
      kind: row.kind as TokenEdit["kind"],
      code: row.word_id ? (vocabulary.byId(row.word_id)?.code ?? row.code_given) : row.code_given,
      meaning_fa: row.meaning_fa_ctx,
    }));
}

/** The words a token list points at, for showing lemma and meaning next to each row. */
export const tokenWords = (language: string, tokens: TokenEdit[]) => wordInfo(language, tokens.map((token) => token.code));

/** Runs the mapping check on edited rows; problems are placed on the word table. */
export function mapForEdit(text: string, tokens: TokenEdit[], vocabulary: LoadedVocabulary, path = "tokens"): { rows: MappedRow[] } | { errors: FieldError[] } {
  const input: TokenInput[] = tokens
    .map((token) => ({
      surface: token.surface.trim(),
      kind: token.kind,
      code: token.kind === "word" ? token.code?.trim() || null : null,
      meaning_fa: token.meaning_fa?.trim() || null,
    }))
    .filter((token) => token.surface);
  if (input.length === 0) return { errors: [{ path, message: describeProblem({ key: "missing", vars: { field: "tokens" } }) }] };
  const mapped = mapSentence({ text, tokens: input }, vocabulary);
  if (!mapped.rows) return { errors: mapped.problems.map((item) => ({ path, message: describeProblem(item) })) };
  return { rows: mapped.rows };
}

/** The most likely list word for a piece of text: same lemma, plural or conjugated form. */
function guess(vocabulary: LoadedVocabulary, surface: string, elided: boolean) {
  const wanted = elided ? [`${surface}e`, `${surface}a`, surface] : [surface];
  for (const form of wanted) {
    const key = bare(form);
    const found = vocabulary.words
      .filter((word) => word.pos !== "phrase" && (bare(word.lemma) === key || (word.plural && bare(word.plural) === key) || word.forms.some((item) => bare(item) === key)))
      .sort((a, b) => Number(fold(a.lemma) !== fold(form)) - Number(fold(b.lemma) !== fold(form)) || a.level.localeCompare(b.level));
    if (found[0]) return found[0];
  }
  return null;
}

const gap = /\s*(?:\.{3}|…)\s*/u;

/**
 * Rows for a changed sentence: rows that still fit the new text are kept as they were, new words get
 * the most likely list word. The admin then fixes what is left (PRD §13.7).
 */
export async function suggestTokens(language: string, text: string, previous: TokenEdit[]): Promise<{ tokens: TokenEdit[]; words: Record<string, WordInfo> }> {
  const vocabulary = await loadVocabulary(db, language);
  const pieces = splitPieces(text);
  const covered = pieces.map(() => false);
  const used = previous.map(() => false);
  const result: TokenEdit[] = [];
  const keyOf = (value: string) => splitPieces(value).map((piece) => fold(piece.text));
  const matchAt = (from: number, wanted: string[]) => wanted.length > 0 && wanted.every((piece, k) => !covered[from + k] && pieces[from + k] && fold(pieces[from + k].text) === piece);

  for (let i = 0; i < pieces.length; i++) {
    if (covered[i]) continue;
    const reuse = previous.findIndex((token, k) => !used[k] && matchAt(i, keyOf(token.surface.split(gap)[0] ?? "")));
    if (reuse >= 0) {
      const token = previous[reuse];
      used[reuse] = true;
      const segments = token.surface.split(gap).filter(Boolean);
      let at = i;
      for (const [index, segment] of segments.entries()) {
        const wanted = keyOf(segment);
        let start = at;
        while (start < pieces.length && !matchAt(start, wanted)) start++;
        if (start >= pieces.length) break;
        for (let k = 0; k < wanted.length; k++) covered[start + k] = true;
        if (index === 0) at = start + wanted.length;
      }
      result.push(token);
      continue;
    }
    const piece = pieces[i];
    covered[i] = true;
    const elided = /^['’]/.test(text.slice(piece.end, piece.end + 1)) && piece.text.length <= 2;
    if (/\p{Nd}/u.test(piece.text)) {
      result.push({ surface: piece.text, kind: "number", code: null, meaning_fa: null });
      continue;
    }
    const word = guess(vocabulary, piece.text, elided);
    result.push({ surface: elided ? `${piece.text}'` : piece.text, kind: "word", code: word?.code ?? null, meaning_fa: null });
  }
  return { tokens: result, words: await tokenWords(language, result) };
}
