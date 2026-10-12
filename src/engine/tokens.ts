/**
 * Word-mapping check for imported sentences (PRD §14.1, "کنترل نگاشت کلمه‌ها"). There is no
 * lemmatizer: the chatbot gives `tokens` and these fixed rules accept them, flag them for the admin
 * (candidate, suspect) or reject the sentence. Pure function; the caller supplies the vocabulary.
 */

export type TokenKind = "word" | "name" | "number" | "other";

export type TokenInput = {
  surface: string;
  kind: TokenKind;
  code: string | null;
  meaning_fa: string | null;
};

/** What the check needs to know about one vocabulary entry. */
export type VocabEntry = {
  id: number;
  lemma: string;
  plural: string | null;
  pos: string;
  /** Every form in the verb's conjugation tables. */
  forms: string[];
  /** Lemmas of the words a phrase is made of (pos = phrase). */
  partLemmas: string[];
};

export type Vocabulary = {
  byCode(code: string): VocabEntry | undefined;
  /** True when some entry's lemma or plural equals this text, ignoring case. */
  hasLemmaOrPlural(text: string): boolean;
  /** The admin already confirmed this surface as a form of this word (`form_exception`). */
  isException(wordId: number, surface: string): boolean;
};

export type MappedRow = {
  position: number;
  kind: TokenKind;
  surface: string;
  /** [start, end) character ranges in the sentence; several for split verbs. */
  spans: [number, number][];
  code_given: string | null;
  word_id: number | null;
  meaning_fa_ctx: string | null;
  candidate_reason: "missing" | "name_matches_word" | null;
  suspect: boolean;
};

export type TokenProblem =
  | { type: "not_found"; position: number; surface: string }
  | { type: "uncovered"; piece: string }
  | { type: "name_not_capital"; position: number; surface: string }
  | { type: "number_without_digit"; position: number; surface: string };

export type CheckTokensResult = { ok: true; rows: MappedRow[] } | { ok: false; problems: TokenProblem[] };

type Piece = { text: string; start: number; end: number };

const letter = /[\p{L}\p{M}]/u;
const digit = /\p{Nd}/u;
/** Splits a split verb or phrase given as "stehe ... auf". */
const gap = /\s*(?:\.{3}|…)\s*/u;

/**
 * Rule 1: pieces are runs of letters. Apostrophes and hyphens separate pieces. A run of digits, with
 * any letter or sign between digits (14h30, 9:15, 2,50), is one piece.
 */
export function splitPieces(text: string): Piece[] {
  const pieces: Piece[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (digit.test(ch)) {
      let end = i + 1;
      while (end < text.length) {
        if (digit.test(text[end])) end++;
        else if (end + 1 < text.length && !/\s/u.test(text[end]) && digit.test(text[end + 1])) end += 2;
        else break;
      }
      pieces.push({ text: text.slice(i, end), start: i, end });
      i = end;
    } else if (letter.test(ch)) {
      let end = i + 1;
      while (end < text.length && letter.test(text[end])) end++;
      pieces.push({ text: text.slice(i, end), start: i, end });
      i = end;
    } else {
      i++;
    }
  }
  return pieces;
}

/** Case-insensitive comparison form that keeps accents. */
function fold(text: string) {
  return text.normalize("NFC").toLocaleLowerCase("und").replace(/[’ʼ`´]/gu, "'");
}

/** Letters only, without accents or case, for the "same first letters" rule. */
export function bare(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/œ/gu, "oe")
    .replace(/æ/gu, "ae")
    .replace(/[^\p{L}\p{Nd}]/gu, "");
}

/** Rule 5, third case: at least the first 3 letters match (or all of the shorter one). */
function sharesStart(a: string, b: string) {
  const x = bare(a);
  const y = bare(b);
  if (!x || !y) return false;
  const n = Math.min(3, x.length, y.length);
  return x.slice(0, n) === y.slice(0, n);
}

/** Rule 5: is this surface a plausible form of this vocabulary entry? */
export function plausibleForm(surface: string, entry: VocabEntry, segments: string[]): boolean {
  const s = bare(surface);
  if (s === bare(entry.lemma) || (entry.plural && s === bare(entry.plural))) return true;
  if (entry.forms.some((form) => bare(form) === s)) return true;
  if (entry.pos === "phrase" && entry.partLemmas.length > 0) {
    const pieces = segments.flatMap((segment) => splitPieces(segment).map((piece) => piece.text));
    return entry.partLemmas.every((part) => pieces.some((piece) => sharesStart(piece, part)));
  }
  // A split verb is compared with its parts joined in reverse: "stehe ... auf" -> "aufstehe".
  const joined = segments.length > 1 ? [...segments].reverse().join("") : surface;
  return sharesStart(joined, entry.lemma);
}

/**
 * Checks one sentence's `tokens` against its text and the vocabulary. Coverage and label errors
 * reject the sentence (rules 2 and 3); unknown codes become candidates (rule 4); implausible
 * mappings become suspects (rules 5 and 6); `name` rows that equal a vocabulary word become
 * candidates (PRD §13.3).
 */
export function checkTokens(text: string, tokens: TokenInput[], vocabulary: Vocabulary): CheckTokensResult {
  const pieces = splitPieces(text);
  const covered = pieces.map(() => false);
  const problems: TokenProblem[] = [];
  const rows: MappedRow[] = [];
  let cursor = 0;

  tokens.forEach((token, position) => {
    while (cursor < pieces.length && covered[cursor]) cursor++;
    const segments = token.surface.split(gap).filter((segment) => segment.trim() !== "");
    const spans: [number, number][] = [];
    let at = cursor;
    let found = segments.length > 0;

    segments.forEach((segment, index) => {
      if (!found) return;
      const wanted = splitPieces(segment).map((piece) => fold(piece.text));
      if (wanted.length === 0) {
        found = false;
        return;
      }
      // The first segment must continue the sentence where the previous token stopped; later
      // segments of a split verb may come further on.
      const start = index === 0 ? at : findRun(pieces, covered, wanted, at);
      if (start < 0 || !matchesAt(pieces, covered, wanted, start)) {
        found = false;
        return;
      }
      for (let k = start; k < start + wanted.length; k++) covered[k] = true;
      spans.push([pieces[start].start, pieces[start + wanted.length - 1].end]);
      at = start + wanted.length;
    });

    if (!found) {
      problems.push({ type: "not_found", position, surface: token.surface });
      return;
    }

    if (token.kind === "name" && !/^\p{Lu}/u.test(token.surface.trim())) {
      problems.push({ type: "name_not_capital", position, surface: token.surface });
    }
    if (token.kind === "number" && !digit.test(token.surface)) {
      problems.push({ type: "number_without_digit", position, surface: token.surface });
    }

    const row: MappedRow = {
      position,
      kind: token.kind,
      surface: token.surface.trim(),
      spans,
      code_given: token.code,
      word_id: null,
      meaning_fa_ctx: token.kind === "name" || token.kind === "other" ? null : token.meaning_fa,
      candidate_reason: null,
      suspect: false,
    };

    if (token.kind === "word") {
      const entry = token.code ? vocabulary.byCode(token.code) : undefined;
      if (!entry) {
        row.candidate_reason = "missing";
      } else {
        row.word_id = entry.id;
        row.suspect = !plausibleForm(row.surface, entry, segments) && !vocabulary.isException(entry.id, row.surface);
      }
    } else if (token.kind === "name" && vocabulary.hasLemmaOrPlural(row.surface)) {
      row.candidate_reason = "name_matches_word";
    }
    rows.push(row);
  });

  pieces.forEach((piece, index) => {
    if (!covered[index]) problems.push({ type: "uncovered", piece: piece.text });
  });

  return problems.length > 0 ? { ok: false, problems } : { ok: true, rows };
}

function matchesAt(pieces: Piece[], covered: boolean[], wanted: string[], start: number) {
  if (start + wanted.length > pieces.length) return false;
  return wanted.every((text, k) => !covered[start + k] && fold(pieces[start + k].text) === text);
}

function findRun(pieces: Piece[], covered: boolean[], wanted: string[], from: number) {
  for (let start = from; start + wanted.length <= pieces.length; start++) {
    if (matchesAt(pieces, covered, wanted, start)) return start;
  }
  return -1;
}
