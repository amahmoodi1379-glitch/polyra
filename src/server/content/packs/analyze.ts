import { fold, splitPieces } from "@/engine/tokens";
import { levelRank } from "../languages";
import { SEPARABLE } from "./closed";
import { verbFormGroups } from "./distractors";
import { bareLemma, type Candidate, type Morph } from "./morph";
import type { PackWord } from "./words";

/**
 * Turns a sentence as an author writes it into the panel's token list (PRD §14.1 rule 10), with every
 * word mapped to a word of the lists. The author marks only what the machine cannot know:
 *   [ ]       the gap (the word or words a learner fills in)
 *   {code}    right after a word or a gap: which word of the lists it is, when the guess is wrong
 * Names come from content/<language>/names.txt; digits are numbers.
 */

export type Token = { surface: string; kind: "word" | "name" | "number"; code: string | null; meaning_fa: string | null };
export type MappedToken = Token & { word: PackWord | null; start: number; end: number; inGap: number | null };
export type Gap = { start: number; end: number; text: string; code: string | null };
export type Parsed = { text: string; gaps: Gap[]; marks: { start: number; end: number; code: string }[] };
export type Analysis = { text: string; tokens: MappedToken[]; gaps: Gap[]; errors: string[]; notes: string[] };

const APOSTROPHE = /['’]/u;
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const persianNumber = (text: string) => text.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);

/** Strips the author's marks: `Je [mange]{manger} une pomme.` → the plain text, the gaps and the codes. */
export function parseMarked(source: string): Parsed | { error: string } {
  let text = "";
  const gaps: Gap[] = [];
  const marks: Parsed["marks"] = [];
  let open: number | null = null;
  let lastWord: { start: number; end: number } | null = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") {
      if (open !== null) return { error: "a gap opens inside another gap" };
      open = text.length;
      continue;
    }
    if (ch === "]") {
      if (open === null) return { error: "a gap closes without opening" };
      gaps.push({ start: open, end: text.length, text: text.slice(open), code: null });
      lastWord = { start: open, end: text.length };
      open = null;
      continue;
    }
    if (ch === "{") {
      const close = source.indexOf("}", i);
      if (close < 0) return { error: "a {code} is not closed" };
      const code = source.slice(i + 1, close).trim();
      if (!code || !lastWord) return { error: "a {code} must follow a word or a gap" };
      const gap = gaps.find((item) => item.start === lastWord!.start && item.end === lastWord!.end);
      if (gap) gap.code = code;
      else marks.push({ ...lastWord, code });
      i = close;
      continue;
    }
    text += ch;
    if (/[\p{L}\p{M}\p{Nd}'’-]/u.test(ch)) {
      // The word that ends here, for a {code} right after it.
      let start = text.length - 1;
      while (start > 0 && /[\p{L}\p{M}\p{Nd}]/u.test(text[start - 1])) start--;
      lastWord = { start, end: text.length };
    }
  }
  if (open !== null) return { error: "a gap is not closed" };
  if (/[[\]{}]/.test(text)) return { error: "a stray bracket" };
  return { text, gaps, marks };
}

/** What a sentence may use: words of this level and lower; for a word's own sentences also «known before». */
export type Scope = {
  level: string;
  /** The word the sentence is written for, if any: other words must be taught before it. */
  target?: PackWord;
  /** Words that count as known among themselves (the first words of a language, PRD §14.9). */
  firstWords?: Set<PackWord>;
};

/** A word of the text; a phrase of the lists that the analyzer joined carries its word (`phrase`). */
type Unit = { surface: string; start: number; end: number; pieces: number; phrase?: PackWord };

/**
 * A phrase of the lists, as folded pieces of its lemma. `verb` is the piece that is a verb of its parts
 * (avoir faim, être d'accord, Hunger haben, es gibt): that piece may stand in any form of the verb.
 */
type Phrase = { word: PackWord; pieces: string[]; verb: { index: number; word: PackWord } | null; plural: string[] | null };

/** French elided words and the pieces of a lemma they stand for: «besoin d'eau» is «besoin de». */
const ELIDED: Record<string, string[]> = { d: ["de"], l: ["le", "la"], qu: ["que"], j: ["je"], m: ["me"], t: ["te"], s: ["se", "si"], n: ["ne"], c: ["ce"] };
/** Words that may stand between a phrase's verb and the rest of it in one clause (hast du morgen Zeit, n'ai pas faim). */
const SPLIT_GAP = 4;
const CLAUSE_END = /[.,;:!?]/;
const foldedPieces = (text: string) => splitPieces(text).map((piece) => fold(piece.text));

/** Pieces of the text grouped into words: French elided forms keep their apostrophe (l', qu'). */
function units(text: string, language: string): Unit[] {
  const pieces = splitPieces(text);
  return pieces.map((piece) => {
    const elided = language === "fr" && APOSTROPHE.test(text[piece.end] ?? "") && /\p{L}/u.test(text[piece.end + 1] ?? "");
    return { surface: elided ? `${piece.text}'` : piece.text, start: piece.start, end: elided ? piece.end + 1 : piece.end, pieces: 1 };
  });
}

const isNoun = (candidate: Candidate) => candidate.word.word.pos === "noun";
const orderKey = (item: PackWord) => levelRank(item.level) * 100000 + item.order;
const sentenceStart = (text: string, at: number) => /^[\s"«„“(¿¡-]*$/u.test(text.slice(0, at)) || /[.!?:]["»“”)]?\s*["«„“(-]*\s*$/u.test(text.slice(0, at));

export class Analyzer {
  private byCode: Map<string, PackWord>;
  private phrases: Phrase[];

  constructor(
    readonly language: string,
    readonly words: PackWord[],
    readonly morph: Morph,
    readonly names: Set<string>,
  ) {
    this.byCode = new Map(words.map((item) => [item.word.code, item]));
    this.phrases = words
      .map((item) => ({ word: item, pieces: foldedPieces(item.word.lemma), verb: null as Phrase["verb"], plural: item.word.plural && foldedPieces(item.word.plural).length > 1 ? foldedPieces(item.word.plural) : null }))
      .filter((item) => item.pieces.length > 1)
      .map((item) => ({ ...item, verb: this.phraseVerb(item.word, item.pieces) }))
      .sort((a, b) => b.pieces.length - a.pieces.length);
  }

  /** The piece of a phrase that is one of its parts' verbs, in its lemma or a form (es gibt: geben). */
  private phraseVerb(item: PackWord, pieces: string[]): Phrase["verb"] {
    const verbs = (item.word.parts ?? []).map((code) => this.byCode.get(code)).filter((part): part is PackWord => part?.word.pos === "verb");
    for (const [index, piece] of pieces.entries()) {
      const verb = verbs.find((part) => fold(bareLemma(part.word.lemma)) === piece || this.morph.candidates(piece).some((candidate) => candidate.word === part));
      if (verb) return { index, word: verb };
    }
    return null;
  }

  /** Does this word of the text stand for piece `k` of the phrase? */
  private pieceMatches(phrase: Phrase, k: number, unit: Unit) {
    const surface = fold(unit.surface.replace(APOSTROPHE, ""));
    const piece = phrase.pieces[k];
    if (surface === piece) return true;
    if (APOSTROPHE.test(unit.surface) && (ELIDED[surface] ?? []).includes(piece)) return true;
    // A verb is never an elided piece (Lexique lists «n'» under avoir).
    return phrase.verb?.index === k && !APOSTROPHE.test(unit.surface) && this.morph.candidates(unit.surface).some((candidate) => candidate.word === phrase.verb!.word);
  }

  /**
   * Where the phrase stands at word `i`: its pieces in the lemma's order (suis d'accord, ai besoin d'), or
   * its verb first (German: habe Hunger, gibt es), or its verb here and the rest later in the same clause
   * (hast du morgen Zeit, n'ai pas faim: `split`). Returns the indexes of the words it takes.
   */
  private phraseAt(phrase: Phrase, list: Unit[], i: number, text: string): { at: number[]; split: boolean } | null {
    const n = phrase.pieces.length;
    const range = (from: number, count: number) => Array.from({ length: count }, (_, k) => from + k);
    const fits = (indexes: number[], order: number[]) => indexes.length === order.length && indexes.every((index, k) => index < list.length && this.pieceMatches(phrase, order[k], list[index]));
    const lemmaOrder = range(0, n);
    if (fits(range(i, n), lemmaOrder)) return { at: range(i, n), split: false };
    // A noun of several words in the plural (pommes de terre).
    const plural = phrase.plural;
    if (plural && plural.every((piece, k) => i + k < list.length && fold(list[i + k].surface.replace(APOSTROPHE, "")) === piece)) return { at: range(i, plural.length), split: false };
    const verb = phrase.verb;
    if (!verb) return null;
    const rest = lemmaOrder.filter((k) => k !== verb.index);
    if (!this.pieceMatches(phrase, verb.index, list[i])) return null;
    if (this.language === "de" && verb.index > 0 && fits(range(i + 1, n - 1), rest)) return { at: range(i, n), split: false };
    // The verb first, the rest later in the clause: French verbs lead their phrase, German finite verbs too.
    if (verb.index === 0 || this.language === "de") {
      for (let j = i + 2; j <= i + 1 + SPLIT_GAP && j + rest.length <= list.length; j++) {
        if (CLAUSE_END.test(text.slice(list[j - 1].end, list[j].start))) break;
        if (fits(range(j, rest.length), rest)) {
          const between = text.slice(list[j].start, list[j + rest.length - 1].end);
          if (!CLAUSE_END.test(between)) return { at: [i, ...range(j, rest.length)], split: true };
        }
      }
    }
    return null;
  }

  word(code: string) {
    return this.byCode.get(code);
  }

  /** Is this surface in names.txt (an apostrophe may be left out)? */
  private listedName(surface: string): boolean {
    return this.names.has(surface) || this.names.has(surface.replace(APOSTROPHE, ""));
  }

  /**
   * A capitalised name of names.txt is the name, not a word form that only looks like it
   * (Wien is not «wie», Paris not «pari», Marie not «se marier»). A word written exactly so wins.
   */
  private isName(surface: string, candidates: Candidate[]): boolean {
    if (!/^\p{Lu}/u.test(surface) || !this.listedName(surface)) return false;
    return !candidates.some((candidate) => candidate.word.word.lemma === surface || candidate.word.word.plural === surface);
  }

  /** May this word appear in a sentence of this scope? */
  allowed(item: PackWord, scope: Scope): boolean {
    if (levelRank(item.level) > levelRank(scope.level)) return false;
    return true;
  }

  /** Is this word known when the scope's target word arrives (usable sentence, PRD §13.11)? */
  knownBefore(item: PackWord, scope: Scope): boolean {
    const target = scope.target;
    if (!target || item === target || item.word.no_card) return true;
    if (scope.firstWords?.has(target) && scope.firstWords.has(item)) return true;
    return orderKey(item) < orderKey(target);
  }

  analyze(source: string, scope: Scope): Analysis {
    const parsed = parseMarked(source);
    if ("error" in parsed) return { text: source, tokens: [], gaps: [], errors: [parsed.error], notes: [] };
    const { text, gaps, marks } = parsed;
    const errors: string[] = [];
    const notes: string[] = [];
    let list = units(text, this.language);

    // Phrases and hyphenated words of the lists (peut-être, il y a, es gibt) take their pieces together
    // when the phrase is one a learner of this scope knows, or the gap is exactly the phrase.
    const merged: Unit[] = [];
    const taken = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      if (taken.has(i)) continue;
      let hit: { phrase: Phrase; at: number[]; split: boolean } | null = null;
      for (const phrase of this.phrases) {
        if (!this.allowed(phrase.word, scope)) continue;
        const found = this.phraseAt(phrase, list, i, text);
        if (!found || found.at.some((index) => taken.has(index))) continue;
        const run = found.at.map((index) => list[index]);
        const first = run[0];
        const last = run[run.length - 1];
        const hyphenated = phrase.word.word.lemma.includes("-");
        // A gap that takes part of the phrase, or the phrase and more: then the pieces stay words.
        const holding = gaps.find((item) => item.start <= first.start && item.end >= last.end);
        const wholeGap = !found.split && holding && holding.start === first.start && holding.end === last.end;
        const overlaps = gaps.some((item) => item.start < last.end && item.end > first.start);
        if (overlaps && !wholeGap) continue;
        if (hyphenated || wholeGap || this.knownBefore(phrase.word, scope)) {
          hit = { phrase, ...found };
          break;
        }
      }
      if (hit) {
        const run = hit.at.map((index) => list[index]);
        for (const index of hit.at) taken.add(index);
        if (hit.split) {
          // Like a separable verb: «hast ... Zeit», at the verb's place.
          const rest = run.slice(1);
          const restText = text.slice(rest[0].start, rest[rest.length - 1].end);
          merged.push({ surface: `${run[0].surface} ... ${restText}`, start: run[0].start, end: run[0].end, pieces: run.length, phrase: hit.phrase.word });
        } else {
          merged.push({ surface: text.slice(run[0].start, run[run.length - 1].end), start: run[0].start, end: run[run.length - 1].end, pieces: run.length, phrase: hit.phrase.word });
        }
      } else merged.push(list[i]);
    }
    list = merged;

    const gapOf = (unit: Unit) => {
      const index = gaps.findIndex((gap) => gap.start <= unit.start && gap.end >= unit.end);
      return index >= 0 ? index : null;
    };
    const tokens: MappedToken[] = [];
    /** Words not found, by start: a German particle may still join its verb (stehe … auf). */
    const unknown = new Map<number, string>();
    const candidatesOf: Candidate[][] = [];
    for (const unit of list) {
      const all = unit.phrase ? [{ word: unit.phrase, score: 10, via: "lemma" as const }] : this.morph.candidates(unit.surface).filter((candidate) => this.allowed(candidate.word, scope));
      candidatesOf.push(all);
    }

    for (const [index, unit] of list.entries()) {
      const inGap = gapOf(unit);
      const base = { surface: unit.surface, start: unit.start, end: unit.end, inGap };
      if (/^\p{Nd}/u.test(unit.surface)) {
        tokens.push({ ...base, kind: "number", code: null, meaning_fa: persianNumber(unit.surface), word: null });
        continue;
      }
      const forced = marks.find((mark) => mark.start <= unit.start && mark.end >= unit.end)?.code ?? (inGap !== null ? gaps[inGap].code : null);
      let candidates = candidatesOf[index];
      let chosen: PackWord | null = null;
      if (forced) {
        chosen = this.byCode.get(forced) ?? null;
        if (!chosen) errors.push(`{${forced}}: no word of the lists has this code`);
        else if (!this.allowed(chosen, scope)) errors.push(`{${forced}} is of level ${chosen.level}, above ${scope.level}`);
      } else if (this.isName(unit.surface, candidates)) {
        tokens.push({ ...base, kind: "name", code: null, meaning_fa: null, word: null });
        continue;
      } else {
        // The gap of a word's own sentence is that word when it can be.
        if (inGap !== null && scope.target && candidates.some((candidate) => candidate.word === scope.target)) chosen = scope.target;
        if (!chosen) candidates = this.narrow(candidates, list, candidatesOf, index, text);
        if (!chosen && candidates.length > 0) {
          chosen = candidates[0].word;
          const rival = candidates.find((candidate) => candidate.word !== chosen && candidate.word.word.pos !== chosen!.word.pos);
          // German: a capitalised first word may be the noun or the verb (Essen ist gut).
          const doubtful = this.language === "de" && sentenceStart(text, unit.start) && rival && (isNoun(rival) || chosen.word.pos === "noun");
          if (rival && (candidates[0].score - rival.score < 1 || doubtful)) {
            notes.push(`«${unit.surface}» read as ${chosen.word.code} (${chosen.word.pos}), not ${rival.word.word.code} (${rival.word.word.pos}); add {${rival.word.word.code}} if wrong`);
          }
        }
      }
      if (!chosen) {
        const capital = /^\p{Lu}/u.test(unit.surface);
        if (capital && this.listedName(unit.surface)) {
          tokens.push({ ...base, kind: "name", code: null, meaning_fa: null, word: null });
          continue;
        }
        const higher = this.morph.candidates(unit.surface).filter((candidate) => !this.allowed(candidate.word, scope));
        unknown.set(
          unit.start,
          higher.length > 0
            ? `«${unit.surface}» is ${higher[0].word.word.code}, of level ${higher[0].word.level}: above ${scope.level}`
            : `«${unit.surface}» is not a form of any word in the lists${capital ? " (a name? add it to names.txt)" : ""}`,
        );
        tokens.push({ ...base, kind: "word", code: null, meaning_fa: null, word: null });
        continue;
      }
      tokens.push({ ...base, kind: "word", code: chosen.word.code, meaning_fa: firstMeaning(chosen.word.meaning_fa), word: chosen });
    }

    this.joinSeparable(tokens, list, candidatesOf, text);
    for (const token of tokens) {
      const problem = unknown.get(token.start);
      if (problem && !token.word) errors.push(problem);
    }

    if (scope.target) {
      for (const token of tokens) {
        if (token.word && token.inGap === null && !this.knownBefore(token.word, scope)) {
          errors.push(`«${token.surface}» (${token.word.word.code}, ${token.word.level} #${token.word.order}) is taught after ${scope.target.word.code} (#${scope.target.order}): use words taught before it`);
        }
      }
    }
    return { text, tokens, gaps, errors, notes };
  }

  /** Context rules for a form that belongs to more than one word. */
  private narrow(candidates: Candidate[], list: Unit[], all: Candidate[][], index: number, text: string): Candidate[] {
    if (candidates.length < 2) return candidates;
    let out = [...candidates];
    const unit = list[index];
    const keep = (rule: (candidate: Candidate) => boolean) => {
      const kept = out.filter(rule);
      if (kept.length > 0) out = kept;
    };
    const next = all[index + 1] ?? [];
    const previous = all[index - 1] ?? [];
    const nextIsVerbOnly = next.length > 0 && next.every((candidate) => candidate.word.word.pos === "verb");
    if (this.language === "de") {
      const capital = /^\p{Lu}/u.test(unit.surface);
      if (capital && !sentenceStart(text, unit.start)) keep((candidate) => isNoun(candidate) || candidate.word.word.lemma === "Sie" || /^\p{Lu}/u.test(candidate.word.word.lemma));
      else if (!capital) keep((candidate) => !isNoun(candidate));
      // sein, ihr, unser: a possessive before a noun or an adjective, else the verb or pronoun.
      if (next.some((candidate) => isNoun(candidate) || candidate.word.word.pos === "adj")) keep((candidate) => candidate.word.word.pos === "det" || candidate.word.word.pos !== "verb");
    } else {
      // le, la, les, l', en: a pronoun before a verb, an article before anything else.
      if (nextIsVerbOnly || /^(en|y)$/u.test(list[index + 1]?.surface ?? "")) keep((candidate) => candidate.word.word.pos === "pron");
      else keep((candidate) => candidate.word.word.pos !== "pron" || !candidates.some((other) => other.word.word.pos === "det"));
      // été, est, pas: a noun after an article; a verb (participle) right after avoir or être.
      const afterArticle = previous.length > 0 && (previous.every((candidate) => candidate.word.word.pos === "det") || (/'$/u.test(list[index - 1]?.surface ?? "") && previous.some((candidate) => candidate.word.word.pos === "det")));
      if (afterArticle) keep((candidate) => candidate.word.word.pos === "noun" || candidate.word.word.pos === "adj");
      else if (previous.some((candidate) => candidate.word.word.lemma === "avoir" || candidate.word.word.lemma === "être")) {
        // Only a past participle («a été», not «suis étudiant»: étudiant is also a form of étudier).
        const participle = (candidate: Candidate) =>
          candidate.word.word.pos === "verb" && (verbFormGroups("fr", candidate.word.word.lemma).find((group) => group.name === "PARTICIPE")?.forms ?? []).some((form) => fold(form) === fold(unit.surface));
        keep(participle);
      }
    }
    // Reflexive verbs: «se laver» when a reflexive pronoun comes shortly before.
    const reflexive = list.slice(Math.max(0, index - 3), index).some((item) => /^(me|m'|te|t'|se|s'|nous|vous|mich|dich|sich|uns|euch|mir|dir)$/iu.test(item.surface));
    if (out.some((candidate) => /^(se |s'|sich )/u.test(candidate.word.word.lemma)) && out.some((candidate) => !/^(se |s'|sich )/u.test(candidate.word.word.lemma))) {
      keep((candidate) => /^(se |s'|sich )/u.test(candidate.word.word.lemma) === reflexive);
    }
    // Separable particles count only when the particle closes the clause (checked in joinSeparable).
    out.sort((a, b) => b.score - a.score || orderKey(a.word) - orderKey(b.word));
    return out;
  }

  /** German «stehe … auf»: a verb form and its particle at the end of the clause become one token. */
  private joinSeparable(tokens: MappedToken[], list: Unit[], all: Candidate[][], text: string) {
    if (this.language !== "de") return;
    for (let i = 0; i < tokens.length; i++) {
      const withParticle = all[i].filter((candidate) => candidate.particle);
      if (withParticle.length === 0) continue;
      for (let j = i + 1; j < tokens.length; j++) {
        const between = text.slice(tokens[j - 1].end, tokens[j].start);
        if (/[.,;:!?]/.test(between)) break;
        const after = text.slice(tokens[j].end, tokens[j + 1]?.start ?? text.length);
        const closes = j === tokens.length - 1 || /[.,;:!?]/.test(after);
        const match = withParticle.find((candidate) => candidate.particle === fold(tokens[j].surface));
        if (closes && match && SEPARABLE.includes(match.particle!) && (tokens[i].inGap === tokens[j].inGap || tokens[j].inGap === null)) {
          tokens[i] = { ...tokens[i], surface: `${tokens[i].surface} ... ${tokens[j].surface}`, code: match.word.word.code, meaning_fa: firstMeaning(match.word.word.meaning_fa), word: match.word };
          tokens.splice(j, 1);
          list.splice(j, 1);
          all.splice(j, 1);
          break;
        }
      }
    }
  }
}

export const firstMeaning = (meaning: string) => meaning.split(/[،,]/u)[0].trim();
export const lemmaOf = (item: PackWord) => bareLemma(item.word.lemma);
