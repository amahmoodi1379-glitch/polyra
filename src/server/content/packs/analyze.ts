import { fold, splitPieces } from "@/engine/tokens";
import { levelRank } from "../languages";
import { SEPARABLE } from "./closed";
import { isAuxiliary, verbFormGroups } from "./distractors";
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
type Phrase = { word: PackWord; pieces: string[]; verb: { index: number; word: PackWord } | null; plural: string[] | null; personal: boolean };

/** A phrase with a personal subject (je voudrais, ich hätte gern) holds its verb in exactly that form: «je veux» is not «je voudrais». */
const PERSONAL = /^(je|j|j'|tu|nous|vous|ich|du|wir|ihr)$/u;
/** Phrases that are themselves only before an infinitive: «je viens de manger», not «je viens de Paris». */
const BEFORE_INFINITIVE = new Set(["venir de"]);
/** French object pronouns that may stand between a word and its infinitive (vient de lui parler). */
const FR_CLITIC = /^(me|m'|te|t'|se|s'|le|la|les|l'|lui|leur|y|en|nous|vous)$/u;
/** French subject pronouns (for a reflexive pronoun's person). */
const FR_SUBJECT = /^(je|j'|tu|il|elle|on|nous|vous|ils|elles)$/u;

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
      .map((item) => {
        const pieces = foldedPieces(item.word.lemma);
        return { word: item, pieces, verb: null as Phrase["verb"], plural: item.word.plural && foldedPieces(item.word.plural).length > 1 ? foldedPieces(item.word.plural) : null, personal: pieces.some((piece) => PERSONAL.test(piece)) };
      })
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
    // A verb is never an elided piece (Lexique lists «n'» under avoir); after je/ich it is the phrase's own form.
    if (phrase.personal && phrase.verb?.index === k && piece !== fold(bareLemma(phrase.verb.word.word.lemma))) return false;
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

  /** Is this word an infinitive (a verb written as its lemma)? */
  private infinitive(unit: Unit | undefined) {
    return !!unit && this.morph.candidates(unit.surface).some((candidate) => candidate.word.word.pos === "verb" && fold(bareLemma(candidate.word.word.lemma)) === fold(unit.surface));
  }

  /**
   * A phrase that the words around it rule out: «venir de» only before an infinitive (je viens de Paris
   * is «come from»), and «avoir mal» not before a participle (j'ai mal dormi is «mal» the adverb).
   */
  private phraseBlocked(phrase: Phrase, at: number[], list: Unit[]): boolean {
    if (this.language === "de") return this.germanPhraseBlocked(phrase, at, list);
    if (this.language !== "fr") return false;
    let after = at[at.length - 1] + 1;
    if (BEFORE_INFINITIVE.has(phrase.word.word.lemma)) {
      while (after < list.length && FR_CLITIC.test(fold(list[after].surface))) after++;
      return !this.infinitive(list[after]);
    }
    const verb = phrase.verb;
    if (verb && verb.index < phrase.pieces.length - 1 && ["avoir", "être"].includes(verb.word.word.lemma) && list[after]) {
      const next = this.morph.candidates(list[after].surface);
      const participle = (candidate: Candidate) => (verbFormGroups("fr", candidate.word.word.lemma).find((group) => group.name === "PARTICIPE")?.forms ?? []).some((form) => fold(form) === fold(list[after].surface));
      return next.length > 0 && next.every((candidate) => candidate.word.word.pos === "verb") && next.some(participle);
    }
    return false;
  }

  /**
   * German: a noun of the phrase with its own article is the plain noun (Der Bus fährt is not «Bus fahren»,
   * keinen Hunger haben still is «Hunger haben»); «es gibt» only in the third person (Gib es mir is «geben»).
   */
  private germanPhraseBlocked(phrase: Phrase, at: number[], list: Unit[]): boolean {
    const nouns = new Set(splitPieces(phrase.word.word.lemma).filter((piece) => /^\p{Lu}/u.test(piece.text)).map((piece) => fold(piece.text)));
    for (const index of at) {
      if (!phrase.verb || phrase.word.word.lemma.includes("-")) break;
      if (!nouns.has(fold(list[index].surface)) || index === 0 || at.includes(index - 1)) continue;
      const before = list[index - 1];
      if (/^kein/u.test(fold(before.surface))) continue;
      if (this.morph.candidates(before.surface).some((candidate) => candidate.word.word.pos === "det")) return true;
    }
    const verb = phrase.verb;
    if (verb && phrase.pieces.includes("es")) {
      const verbAt = at.find((index) => this.pieceMatches(phrase, verb.index, list[index]));
      if (verbAt === undefined) return false;
      const surface = fold(list[verbAt].surface);
      const groups = verbFormGroups("de", verb.word.word.lemma);
      const third = groups.flatMap((group) => (["PRÄ", "PRT", "KJ2", "KJ1"].includes(group.name) ? [group.forms[2]] : ["PA2", "INF"].includes(group.name) ? group.forms : [])).filter(Boolean).map(fold);
      if (third.length > 0 && !third.includes(surface)) return true;
    }
    return false;
  }

  word(code: string) {
    return this.byCode.get(code);
  }

  /** Is this surface in names.txt (an apostrophe may be left out)? */
  private listedName(surface: string): boolean {
    if (this.names.has(surface) || this.names.has(surface.replace(APOSTROPHE, ""))) return true;
    // A German name in the genitive: Annas Auto, Peters Bruder (Max' has the apostrophe above).
    return this.language === "de" && surface.length > 2 && surface.endsWith("s") && this.names.has(surface.slice(0, -1));
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
        if (this.phraseBlocked(phrase, found.at, list)) continue;
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
    /** Where the author gave a code: joinSeparable keeps to it. */
    const forcedAt = new Set<number>();
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
      if (forced) forcedAt.add(unit.start);
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
        if (!chosen) candidates = this.narrow(candidates, list, candidatesOf, index, text, tokens);
        if (!chosen && candidates.length > 0) {
          chosen = candidates[0].word;
          // A reading the learner already knows, when the context allows one (est fermé: fermer before fermé is taught).
          const known = scope.target && !this.knownBefore(chosen, scope) ? candidates.find((candidate) => this.knownBefore(candidate.word, scope)) : undefined;
          if (known) {
            chosen = known.word;
            candidates = [known, ...candidates.filter((candidate) => candidate !== known)];
          }
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

    this.joinSeparable(tokens, list, candidatesOf, text, forcedAt);
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

  /** Context rules for a form that belongs to more than one word; `done` holds the words read before it. */
  private narrow(candidates: Candidate[], list: Unit[], all: Candidate[][], index: number, text: string, done: MappedToken[]): Candidate[] {
    if (candidates.length < 2) return candidates;
    let out = [...candidates];
    const unit = list[index];
    const keep = (rule: (candidate: Candidate) => boolean) => {
      const kept = out.filter(rule);
      if (kept.length > 0) out = kept;
    };
    /** Ahead of the others, but kept: a word a learner does not know yet may still give way (see analyze). */
    let preferred: ((candidate: Candidate) => boolean) | null = null;
    const prefer = (rule: (candidate: Candidate) => boolean) => {
      if (out.some(rule) && out.some((candidate) => !rule(candidate))) preferred = rule;
    };
    const next = all[index + 1] ?? [];
    const pos = (candidate: Candidate) => candidate.word.word.pos;
    let reflexive = list.slice(Math.max(0, index - 3), index).some((item) => /^(me|m'|te|t'|se|s'|nous|vous|mich|dich|sich|uns|euch|mir|dir)$/iu.test(item.surface));
    if (this.language === "de") {
      const capital = /^\p{Lu}/u.test(unit.surface);
      if (capital && !sentenceStart(text, unit.start)) keep((candidate) => isNoun(candidate) || candidate.word.word.lemma === "Sie" || /^\p{Lu}/u.test(candidate.word.word.lemma));
      else if (!capital) keep((candidate) => !isNoun(candidate));
      this.narrowGerman(out, keep, prefer, list, all, index, text, done);
    } else {
      reflexive = this.frenchReflexive(list, index, text);
      const surface = fold(unit.surface);
      const nextSurface = fold(list[index + 1]?.surface ?? "");
      const nextHyphened = list[index + 1] !== undefined && text[list[index + 1].start - 1] === "-";
      const nextIsVerbOnly = next.length > 0 && next.every((candidate) => pos(candidate) === "verb");
      const joined = (from: number) => from >= 0 && !/[,.;:!?«»"()]/u.test(text.slice(list[from].end, list[from + 1].start));
      const before = joined(index - 1) ? (done[index - 1]?.word ?? null) : null;
      const beforeSurface = joined(index - 1) ? fold(list[index - 1].surface) : "";
      const isVerb = (candidate: Candidate) => pos(candidate) === "verb";
      const isPron = (candidate: Candidate) => pos(candidate) === "pron";
      // After a subject or object pronoun, or ne: the verb (je bois, il la porte, on danse), or another pronoun.
      const afterName = joined(index - 1) && done[index - 1]?.kind === "name";
      const clitic = (before !== null && before.word.pos === "pron") || beforeSurface === "ne" || beforeSurface === "n'" || afterName;
      // An elided word is never a verb (Lexique lists «n'» under avoir).
      if (/'$/u.test(surface)) keep((candidate) => !isVerb(candidate));

      // c' is always ce the pronoun; -le, -en, -leur after an imperative are pronouns; s'il is si.
      if (surface === "c'" || surface === "ç'") keep(isPron);
      else if (text[unit.start - 1] === "-") keep(isPron);
      else if (surface === "s'" && /^ils?$/u.test(nextSurface)) keep((candidate) => pos(candidate) === "conj");
      // le, la, les, l', leur, en, ce: a pronoun before a verb (or after a subject: il la porte), an article before anything else.
      else if (nextIsVerbOnly || /^(en|y)$/u.test(nextSurface) || (surface === "ce" && /^(ne|n'|qui|que|qu'|dont)$/u.test(nextSurface)) || (clitic && next.some(isVerb))) keep(isPron);
      else keep((candidate) => !isPron(candidate) || !candidates.some((other) => pos(other) === "det"));

      // The words just before, past ne … pas and short adverbs: an auxiliary (a été, n'est pas fermé)?
      let back = index - 1;
      while (back >= 0 && joined(back) && index - back <= 3 && (/^(ne|n'|pas|plus|jamais|rien|tout|bien|déjà|encore|toujours|très|vraiment|trop|assez|souvent|beaucoup|mal|peu|presque)$/u.test(fold(list[back].surface)))) back--;
      const auxiliary = back >= 0 && joined(back) && done[back]?.word?.word.pos === "verb" ? bareLemma(done[back]!.word!.word.lemma) : null;
      const article = before !== null && (before.word.pos === "det" || before.word.pos === "num") && !/^(quel|tout)$/u.test(bareLemma(before.word.lemma));
      const participle = (candidate: Candidate) => isVerb(candidate) && this.formIn(candidate, "PARTICIPE", unit.surface);
      if (article) keep((candidate) => isNoun(candidate) || pos(candidate) === "adj");
      else if (auxiliary === "avoir") keep((candidate) => participle(candidate) || pos(candidate) === "adv");
      else if (auxiliary === "être") {
        // Only a past participle or an adjective («a été», «est fermé», not «suis étudiant» the verb).
        keep((candidate) => participle(candidate) || pos(candidate) === "adj" || pos(candidate) === "adv");
        // est fermé, est ouvert: the adjective when there is one, unless the verb is reflexive (se sont mariés).
        if (!reflexive) prefer((candidate) => !isVerb(candidate));
      } else if (before !== null && before.word.pos === "prep") {
        // en été, de bois: a noun after a preposition, a verb only as an infinitive or in -ant (pour manger, en marchant).
        keep((candidate) => !isVerb(candidate) || fold(bareLemma(candidate.word.word.lemma)) === surface || /ant$/u.test(surface));
      } else if (clitic) keep((candidate) => isVerb(candidate) || isPron(candidate));
      // Mon frère danse, le train part: a noun right after a noun is rare, the verb is likely.
      else if (before !== null && before.word.pos === "noun" && out.some(isVerb)) keep((candidate) => !isNoun(candidate));
      else if (sentenceStart(text, unit.start) && out.some(isNoun)) {
        // A sentence does not open with a bare noun: Ferme la porte, Bois de l'eau are verbs.
        keep((candidate) => isVerb(candidate) && this.formIn(candidate, "PRESENT", unit.surface));
      }

      // vit is vivre, not voir in the passé simple; suis and sommes are être, unless «suis-moi».
      if (out.filter(isVerb).length > 1) keep((candidate) => !isVerb(candidate) || !this.onlyLiterary(candidate, unit.surface));
      const aux = (candidate: Candidate) => isVerb(candidate) && /^(être|avoir)$/u.test(candidate.word.word.lemma);
      const objectAfter = nextHyphened && /^(moi|toi|le|la|les|lui|leur|nous|vous)$/u.test(nextSurface);
      if (out.some(aux) && out.some((candidate) => isVerb(candidate) && !aux(candidate)) && !objectAfter) keep((candidate) => aux(candidate) || !isVerb(candidate));

      // quand: the question word in a question or after savoir, demander, dire; else «when» joining two clauses.
      if (out.some((candidate) => candidate.word.word.code === "quand") && out.some((candidate) => candidate.word.word.code === "quand-conj")) {
        const rest = text.slice(unit.end);
        const stop = rest.search(/[.!?]/u);
        const clause = stop >= 0 ? rest.slice(0, stop) : rest;
        const asked = done.slice(Math.max(0, index - 3), index).some((token) => token.word && /^(savoir|demander|se demander|dire|expliquer)$/u.test(token.word.word.lemma));
        const question = asked || /^\s*-?\s*est-ce\b/iu.test(rest) || (rest[stop] === "?" && !clause.includes(",") && (sentenceStart(text, unit.start) || /^\s*$/u.test(clause)));
        keep((candidate) => (candidate.word.word.code === "quand") === question);
      }
      // plus: «no longer» after ne (je ne fume plus), else «more».
      if (out.some((candidate) => candidate.word.word.code === "plus") && out.some((candidate) => candidate.word.word.code === "plus-2")) {
        const window = list.slice(Math.max(0, index - 4), index).map((item) => fold(item.surface));
        const ne = window.findLastIndex((item) => item === "ne" || item === "n'");
        const negative = ne >= 0 && !window.slice(ne).includes("pas") && joined(index - 1);
        keep((candidate) => (candidate.word.word.code === "plus-2") === negative);
      }
    }
    // Reflexive verbs: «se laver» when a reflexive pronoun of the same person comes shortly before.
    if (out.some((candidate) => /^(se |s'|sich )/u.test(candidate.word.word.lemma)) && out.some((candidate) => !/^(se |s'|sich )/u.test(candidate.word.word.lemma))) {
      keep((candidate) => /^(se |s'|sich )/u.test(candidate.word.word.lemma) === reflexive);
    }
    // Separable particles count only when the particle closes the clause (checked in joinSeparable).
    out.sort((a, b) => b.score - a.score || orderKey(a.word) - orderKey(b.word));
    const rule = preferred as ((candidate: Candidate) => boolean) | null;
    if (rule && out.some(rule) && out.some((candidate) => !rule(candidate))) {
      const top = out[0].score + 1;
      out = [...out.filter(rule).map((candidate) => ({ ...candidate, score: top })), ...out.filter((candidate) => !rule(candidate))];
    }
    return out;
  }

  /** German context rules (after the capital-letter rule); `keep` narrows, `prefer` puts first but keeps. */
  private narrowGerman(
    start: Candidate[],
    keep: (rule: (candidate: Candidate) => boolean) => void,
    prefer: (rule: (candidate: Candidate) => boolean) => void,
    list: Unit[],
    all: Candidate[][],
    index: number,
    text: string,
    done: MappedToken[],
  ) {
    let out = start;
    const keepHere = (rule: (candidate: Candidate) => boolean) => {
      keep(rule);
      const kept = out.filter(rule);
      if (kept.length > 0) out = kept;
    };
    const unit = list[index];
    const surface = fold(unit.surface);
    const pos = (candidate: Candidate) => candidate.word.word.pos;
    const isVerb = (candidate: Candidate) => pos(candidate) === "verb";
    const next = all[index + 1] ?? [];
    const nextUnit = list[index + 1];
    const joined = (from: number) => from >= 0 && from + 1 < list.length && !/[,.;:!?«»"()–]/u.test(text.slice(list[from].end, list[from + 1].start));
    const clauseEnd = !nextUnit || /[,.;:!?]/u.test(text.slice(unit.end, nextUnit.start));
    const sentence = (() => {
      let from = index;
      while (from > 0 && !/[.!?;]/u.test(text.slice(list[from - 1].end, list[from].start))) from--;
      let to = index;
      while (to + 1 < list.length && !/[.!?;]/u.test(text.slice(list[to].end, list[to + 1].start))) to++;
      return { from, to };
    })();
    const clauseStart = (() => {
      let from = index;
      while (from > sentence.from && !/,/u.test(text.slice(list[from - 1].end, list[from].start))) from--;
      return from;
    })();
    const subject = /^(ich|du|er|sie|es|wir|ihr|man)$/u;
    const leads = (at: number) => at === clauseStart || (at > 0 && joined(at - 1) && /^(und|aber|oder|denn|sondern|doch)$/u.test(fold(list[at - 1].surface)));
    const nextNounish = nextUnit !== undefined && joined(index) && next.some((candidate) => (isNoun(candidate) && /^\p{Lu}/u.test(nextUnit.surface)) || pos(candidate) === "adj");

    // A separable verb's stem (stehe of aufstehen) only with its particle: joinSeparable puts it back.
    if (out.some((candidate) => !candidate.particle)) keepHere((candidate) => !candidate.particle);
    // sein, ihr, unser: a possessive before a noun or an adjective (mit meiner Mutter, ihre Tasche), else the verb or pronoun.
    if (nextNounish) {
      keepHere((candidate) => pos(candidate) === "det" || !isVerb(candidate));
      if (surface !== "ihr") keepHere((candidate) => pos(candidate) === "det");
    }
    // Ich weiß, Das weiß ich: a verb right after a subject that opens the clause, or right before a subject.
    const afterSubject = index > 0 && joined(index - 1) && subject.test(fold(list[index - 1].surface)) && leads(index - 1);
    const beforeSubject = nextUnit !== undefined && joined(index) && subject.test(fold(nextUnit.surface)) && index > clauseStart;
    if ((afterSubject || beforeSubject) && out.some(isVerb)) {
      keepHere(isVerb);
      return;
    }
    // ..., weil er es weiß: the verb ends a subordinate clause; a determiner never ends a clause (Arzt sein).
    if (clauseEnd) {
      const subordinate = /^(weil|dass|wenn|ob|als|obwohl|damit|bevor|nachdem|während|bis|seit|seitdem|sodass)$/u.test(fold(list[clauseStart].surface));
      if (subordinate && out.some(isVerb)) keepHere(isVerb);
      keepHere((candidate) => pos(candidate) !== "det");
    }
    // An adverb does not take endings: «ganzen» is the adjective ganz.
    keepHere((candidate) => !(pos(candidate) === "adv" && fold(bareLemma(candidate.word.word.lemma)) !== surface && out.some((other) => other !== candidate && pos(other) === "adj" && other.word.word.lemma === candidate.word.word.lemma)));
    // ganz gut, zu spät, zu viel: the adverb before an adjective or adverb, the preposition before anything else.
    const nextAfter = list[index + 2];
    const nounAfter = nextAfter !== undefined && /^\p{Lu}/u.test(nextAfter.surface) && (all[index + 2] ?? []).some(isNoun);
    if (nextUnit && joined(index) && /^\p{Ll}/u.test(nextUnit.surface) && next.some((candidate) => pos(candidate) === "adj" || pos(candidate) === "adv") && !next.some((candidate) => pos(candidate) === "det" || pos(candidate) === "pron" || isVerb(candidate)) && (!nounAfter || next.some((candidate) => /^(viel|wenig)$/u.test(candidate.word.word.lemma)))) {
      prefer((candidate) => pos(candidate) === "adv");
    }
    // A participle without haben, sein or werden in its sentence is an adjective or another verb's form (Das gehört mir, Geschlossen!).
    const auxiliary = list.slice(sentence.from, sentence.to + 1).some((item, k) => sentence.from + k !== index && isAuxiliary(this.morph, item.surface));
    if (!auxiliary) keepHere((candidate) => !isVerb(candidate) || !this.formIn(candidate, "PA2", unit.surface) || ["PRÄ", "PRT", "KJ2", "KJ1", "INF"].some((group) => this.formIn(candidate, group, unit.surface)));

    // bitte, danke, mehr, heiß, Morgens: the word written exactly as its lemma, unless it is another word's comparative (früher, lieber).
    const comparative = out.some((candidate) => pos(candidate) === "adj" && `${fold(bareLemma(candidate.word.word.lemma))}er` === surface.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC"));
    const exact = (candidate: Candidate) => fold(bareLemma(candidate.word.word.lemma)) === surface;
    if (out.some(exact)) {
      if (!comparative || sentenceStart(text, unit.start)) prefer(exact);
    } else if (out.length > 1 && out.every((candidate) => pos(candidate) === "adj")) {
      // nächsten: nächste, not nah.
      const common = (candidate: Candidate) => {
        const lemma = fold(bareLemma(candidate.word.word.lemma));
        let k = 0;
        while (k < lemma.length && lemma[k] === surface[k]) k++;
        return k;
      };
      const best = Math.max(...out.map(common));
      if (out.filter((candidate) => common(candidate) >= best - 1).length === 1) prefer((candidate) => common(candidate) === best);
    }
    // Der Laden ist geschlossen: after sein, the adjective before the participle.
    let back = index - 1;
    while (back >= 0 && joined(back) && index - back <= 3 && done[back]?.word?.word.pos === "adv") back--;
    if (back >= 0 && joined(back) && done[back]?.word?.word.pos === "verb" && bareLemma(done[back]!.word!.word.lemma) === "sein") prefer((candidate) => pos(candidate) === "adj");
  }

  private forms = new Map<string, Map<string, string[]>>();
  /** Is the surface a form of this verb in this group of verbFormGroups (PRESENT, PARTICIPE, PASSE_SIMPLE …)? */
  private formIn(candidate: Candidate, group: string, surface: string): boolean {
    const lemma = candidate.word.word.lemma;
    let groups = this.forms.get(lemma);
    if (!groups) {
      groups = new Map(verbFormGroups(this.language, lemma).map((item) => [item.name, item.forms.map(fold)]));
      this.forms.set(lemma, groups);
    }
    return (groups.get(group) ?? []).includes(fold(surface));
  }

  /** A form only of the passé simple (vit of voir; il vit is vivre). */
  private onlyLiterary(candidate: Candidate, surface: string): boolean {
    if (!this.formIn(candidate, "PASSE_SIMPLE", surface)) return false;
    return !["PRESENT", "IMPARFAIT", "FUTUR", "CONDITIONNEL_PRESENT", "SUBJONCTIF_PRESENT", "PARTICIPE", "INFINITIF"].some((group) => this.formIn(candidate, group, surface));
  }

  /**
   * Is a French me, te, se, nous or vous shortly before this word reflexive? se always; me only with je,
   * te with tu, nous and vous with the same subject (vous vous levez), not «je t'appelle», «vous ne trouvez».
   * Without a subject (an infinitive, an imperative) me and te are, and nous or vous after another word.
   */
  private frenchReflexive(list: Unit[], index: number, text: string): boolean {
    const same: Record<string, string[]> = { me: ["je", "j'"], "m'": ["je", "j'"], te: ["tu"], "t'": ["tu"], nous: ["nous"], vous: ["vous"] };
    for (let at = index - 1; at >= Math.max(0, index - 3); at--) {
      const pronoun = fold(list[at].surface);
      if (pronoun === "se" || pronoun === "s'") {
        if (/^ils?$/u.test(fold(list[at + 1]?.surface ?? ""))) continue;
        return true;
      }
      if (!same[pronoun]) continue;
      let subject: string | null = null;
      for (let back = at - 1; back >= Math.max(0, at - 6); back--) {
        if (/[.!?;]/u.test(text.slice(list[back].end, list[back + 1].start))) break;
        const word = fold(list[back].surface);
        if (FR_SUBJECT.test(word)) {
          subject = word;
          break;
        }
      }
      if (subject !== null) {
        if (same[pronoun].includes(subject)) return true;
        continue;
      }
      if (pronoun === "nous" || pronoun === "vous") {
        if (!sentenceStart(text, list[at].start) && !/,\s*$/u.test(text.slice(0, list[at].start))) return true;
        continue;
      }
      return true;
    }
    return false;
  }

  /** German «stehe … auf»: a verb form and its particle at the end of the clause become one token. */
  private joinSeparable(tokens: MappedToken[], list: Unit[], all: Candidate[][], text: string, forced: Set<number>) {
    if (this.language !== "de") return;
    for (let i = 0; i < tokens.length; i++) {
      // A word the author marked joins only as that word ({sich anziehen}); {ziehen} does not join.
      const withParticle = all[i].filter((candidate) => candidate.particle && (!forced.has(tokens[i].start) || candidate.word === tokens[i].word));
      if (withParticle.length === 0) continue;
      for (let j = i + 1; j < tokens.length; j++) {
        const between = text.slice(tokens[j - 1].end, tokens[j].start);
        if (/[.,;:!?]/.test(between)) break;
        const after = text.slice(tokens[j].end, tokens[j + 1]?.start ?? text.length);
        // The particle closes the clause, or comes right before und, oder, aber (Ich stand auf und ging).
        const closes = j === tokens.length - 1 || /[.,;:!?]/.test(after) || /^(und|oder|aber|sondern|denn)$/u.test(fold(tokens[j + 1]?.surface ?? ""));
        // sich anziehen when mich, dich, sich … stands between the verb and its particle.
        const reflexive = tokens.slice(i + 1, j).some((token) => /^(mich|dich|sich|uns|euch)$/u.test(fold(token.surface)));
        const fits = withParticle.filter((candidate) => candidate.particle === fold(tokens[j].surface) && (!forced.has(tokens[j].start) || candidate.word === tokens[j].word));
        const match = fits.find((candidate) => /^sich /u.test(candidate.word.word.lemma) === reflexive) ?? fits[0];
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
