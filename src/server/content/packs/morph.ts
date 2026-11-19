import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerbsInfo as GermanVerbs } from "german-verbs-dict";
import { fold } from "@/engine/tokens";
import { closedTable } from "./closed";
import type { PackWord } from "./words";

/**
 * Which word of the lists an inflected form belongs to, and the forms of a word, without a chatbot:
 * French from Lexique 3.83 (`data/lexicon/fr-forms.tsv`), German nouns from Wiktionary
 * (`de-forms.tsv`), German verbs from Morphy (german-verbs-dict), German adjective endings by rule, and
 * function words from `closed.ts`. Used to write a sentence's tokens and the wrong options of its gap.
 */

export type Reading = { lemma: string; tag: string; gn: string; freq: number };

const readingsCache = new Map<string, Map<string, Reading[]>>();

/** The form lexicon of a language: form → its readings (lemma, category, gender-number, frequency). */
export function formReadings(language: string, root = process.cwd()): Map<string, Reading[]> {
  const cached = readingsCache.get(language);
  if (cached) return cached;
  const out = new Map<string, Reading[]>();
  for (const line of readFileSync(join(root, "data", "lexicon", `${language}-forms.tsv`), "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [form, rest = ""] = line.split("\t");
    out.set(
      form,
      rest.split(";").map((item) => {
        const [lemma, tag, gn, freq] = item.split("|");
        return { lemma, tag, gn, freq: Number(freq) || 0 };
      }),
    );
  }
  readingsCache.set(language, out);
  return out;
}

let germanVerbs: GermanVerbs | null = null;
export function germanVerbDict(root = process.cwd()): GermanVerbs {
  germanVerbs ??= JSON.parse(readFileSync(join(root, "node_modules", "german-verbs-dict", "dist", "verbs.json"), "utf8")) as GermanVerbs;
  return germanVerbs;
}

/** Lexique's category of a reading as the lists' part of speech; null when any part of speech may do. */
function frenchPos(tag: string): string[] {
  if (tag === "NOM") return ["noun"];
  if (tag === "VER" || tag === "AUX") return ["verb"];
  if (tag === "ADJ") return ["adj"];
  if (tag === "ADV") return ["adv"];
  if (tag === "PRE") return ["prep"];
  if (tag === "CON") return ["conj"];
  if (tag === "ONO") return ["interj"];
  if (tag.startsWith("ART") || tag.startsWith("ADJ:")) return ["det", "adj", "num", "pron"];
  if (tag.startsWith("PRO")) return ["pron", "det"];
  return [];
}

/** A word a form may belong to, with how sure the match is (higher wins when two words fit). */
export type Candidate = { word: PackWord; score: number; via: "lemma" | "form" | "closed" | "verb" | "adjective"; particle?: string; gn?: string };

const add = (map: Map<string, Candidate[]>, form: string, candidate: Candidate) => {
  const key = fold(form);
  const list = map.get(key) ?? [];
  const same = list.find((item) => item.word === candidate.word && item.particle === candidate.particle);
  if (same) same.score = Math.max(same.score, candidate.score);
  else list.push(candidate);
  map.set(key, list);
};

/** German adjective endings, comparative and superlative (gut → besser, best-). */
const GERMAN_COMPARISON: Record<string, [string, string]> = {
  gut: ["besser", "best"],
  viel: ["mehr", "meist"],
  gern: ["lieber", "liebst"],
  hoch: ["höher", "höchst"],
  nah: ["näher", "nächst"],
  groß: ["größer", "größt"],
};
const UMLAUT_COMPARISON = new Set(["alt", "arm", "hart", "jung", "kalt", "klug", "krank", "kurz", "lang", "scharf", "schwach", "stark", "warm", "dumm", "oft", "nass", "grob", "gesund"]);
const ENDINGS = ["", "e", "en", "em", "er", "es"];

function germanStem(lemma: string) {
  if (lemma === "hoch") return "hoh";
  if (/[^aeiouäöü](el|er)$/.test(lemma) && lemma.length > 4) return lemma.slice(0, -2) + lemma.slice(-1); // dunkel → dunkl, teuer → teur
  if (lemma.endsWith("e")) return lemma.slice(0, -1);
  return lemma;
}

function umlaut(text: string) {
  const at = text.search(/[aou](?!.*[aou])/);
  if (at < 0) return text;
  const map: Record<string, string> = { a: "ä", o: "ö", u: "ü" };
  return text.slice(0, at) + map[text[at]] + text.slice(at + 1);
}

/** Every inflected form of a German adjective, each with its ending ("" for the plain form). */
export function germanAdjectiveForms(lemma: string): { form: string; ending: string; degree: 0 | 1 | 2 }[] {
  const out: { form: string; ending: string; degree: 0 | 1 | 2 }[] = [];
  const stem = germanStem(lemma);
  for (const ending of ENDINGS) out.push({ form: ending ? stem + ending : lemma, ending, degree: 0 });
  const [comparative, superlative] = GERMAN_COMPARISON[lemma] ?? [
    (UMLAUT_COMPARISON.has(lemma) ? umlaut(stem) : stem) + "er",
    (UMLAUT_COMPARISON.has(lemma) ? umlaut(lemma) : lemma) + (/[dtszßx]$/.test(lemma) ? "est" : "st"),
  ];
  for (const ending of ENDINGS) out.push({ form: comparative + ending, ending, degree: 1 });
  for (const ending of ENDINGS.slice(1)) out.push({ form: superlative + ending, ending, degree: 2 });
  out.push({ form: `${superlative}en`, ending: "en", degree: 2 });
  return out;
}

/** A word's lemma without a reflexive pronoun (se laver → laver, sich freuen → freuen). */
export const bareLemma = (lemma: string) => lemma.replace(/^(se |s'|sich )/u, "");

export class Morph {
  readonly language: string;
  private forms = new Map<string, Candidate[]>();
  private readings: Map<string, Reading[]>;
  /** Lexique forms of each French lemma (lower case), for the wrong options of an inflected gap. */
  private byLemma = new Map<string, { form: string; tag: string; gn: string }[]>();

  constructor(language: string, words: PackWord[], root = process.cwd()) {
    this.language = language;
    this.readings = formReadings(language, root);
    const byLemma = new Map<string, PackWord[]>();
    for (const item of words) {
      const key = fold(bareLemma(item.word.lemma));
      byLemma.set(key, [...(byLemma.get(key) ?? []), item]);
      // The lexicon's frequency of each reading decides between two words (été: the verb before the season);
      // the lemma itself only starts above an unknown form.
      add(this.forms, item.word.lemma, { word: item, score: 6, via: "lemma" });
      if (item.word.plural) add(this.forms, item.word.plural, { word: item, score: 6, via: "lemma" });
    }
    // Forms from the lexicon: a reading whose lemma is a word of the lists with a fitting part of speech.
    for (const [form, list] of this.readings) {
      for (const reading of list) {
        const owners = byLemma.get(fold(reading.lemma)) ?? [];
        if (language === "fr") {
          const lemmaForms = this.byLemma.get(fold(reading.lemma)) ?? [];
          lemmaForms.push({ form, tag: reading.tag, gn: reading.gn });
          this.byLemma.set(fold(reading.lemma), lemmaForms);
        }
        for (const owner of owners) {
          const fits = language === "fr" ? frenchPos(reading.tag).includes(owner.word.pos) : owner.word.pos === "noun";
          if (fits) add(this.forms, form, { word: owner, score: 5 + Math.min(4, Math.log10(1 + reading.freq)), via: "form", gn: reading.gn });
        }
      }
    }
    // Function words.
    for (const item of words) {
      if (!["det", "pron", "prep", "conj", "adv", "num"].includes(item.word.pos)) continue;
      // Reverse: every form the closed table files under this lemma.
      for (const [form, lemmas] of closedTable(language)) {
        if (lemmas.includes(item.word.lemma)) add(this.forms, form, { word: item, score: 8, via: "closed" });
      }
    }
    if (language === "de") {
      const dict = germanVerbDict(root);
      for (const item of words) {
        if (item.word.pos === "verb") this.addGermanVerb(dict, item);
        if (item.word.pos === "adj" || item.word.pos === "adv") {
          for (const { form } of germanAdjectiveForms(item.word.lemma)) add(this.forms, form, { word: item, score: 7, via: "adjective" });
        }
      }
    }
  }

  private addGermanVerb(dict: GermanVerbs, item: PackWord) {
    const verb = bareLemma(item.word.lemma);
    const info = dict[verb] as unknown as Record<string, unknown> | undefined;
    if (!info) return;
    const visit = (value: unknown) => {
      if (typeof value === "string") add(this.forms, value, { word: item, score: 8, via: "verb" });
      else if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string" && info.hasPrefix) {
        add(this.forms, value[0], { word: item, score: 8, via: "verb", particle: value[1] });
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    for (const [key, value] of Object.entries(info)) if (key !== "hasPrefix") visit(value);
    // zu-infinitive of a separable verb (aufzustehen) and the short imperative (geh, komm).
    const prefix = info.hasPrefix ? (Object.values((info.PRÄ as Record<string, Record<string, [string, string]>>)?.S ?? {})[0]?.[1] ?? "") : "";
    if (prefix && verb.startsWith(prefix)) add(this.forms, `${prefix}zu${verb.slice(prefix.length)}`, { word: item, score: 8, via: "verb" });
    const imperative = (info.IMP as { S?: unknown } | undefined)?.S;
    if (typeof imperative === "string" && imperative.endsWith("e")) add(this.forms, imperative.slice(0, -1), { word: item, score: 7, via: "verb" });
  }

  /** Words of the lists this surface may be a form of (any level; the caller filters). */
  candidates(surface: string): Candidate[] {
    const found = [...(this.forms.get(fold(surface)) ?? [])];
    return found.sort((a, b) => b.score - a.score);
  }

  /** Lexique readings of a French form (gender-number of «petite» is fs). */
  frenchReadings(surface: string): Reading[] {
    return this.readings.get(surface) ?? this.readings.get(surface.toLowerCase()) ?? [];
  }

  /**
   * French form of a lemma with this category and gender-number (forms of «grand» with ADJ fs: grande).
   * An adjective with one form for both genders has no gender in Lexique («jaunes»: p), so «fp» falls
   * back to «p»; the other way round, only such adjectives fit a gap whose form has no gender.
   */
  frenchForm(lemma: string, tag: string, gn: string): string | null {
    const all = (this.byLemma.get(fold(lemma)) ?? []).filter((item) => item.tag === tag);
    const exact = all.find((item) => item.gn === gn);
    if (exact) return exact.form;
    return gn.length === 2 ? (all.find((item) => item.gn === gn[1])?.form ?? null) : null;
  }

  /** German noun forms of a lemma with their gender-number tag (all cases mixed). */
  germanNounForms(lemma: string): string[] {
    const out: string[] = [];
    for (const [form, list] of this.readings) if (list.some((item) => item.lemma === lemma)) out.push(form);
    return out;
  }
}
