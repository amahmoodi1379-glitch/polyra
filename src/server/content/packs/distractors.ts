import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as frenchVerbs from "french-verbs";
import type { VerbsInfo as FrenchVerbs } from "french-verbs-lefff";
import { fold } from "@/engine/tokens";
import { isCardRegister } from "@/engine/content";
import { levelRank } from "../languages";
import { germanVerb } from "../german-verbs";
import { bareLemma, germanAdjectiveForms, type Morph } from "./morph";
import type { PackWord } from "./words";

/**
 * The three wrong options of a word's gap (W3b, PRD §5.5), when the author gives none:
 * - a verb in a conjugated form: other forms of the same verb (the P-S rule), with its infinitive as hint;
 * - any other word: other words of the same part of speech and topic, in the same form (same gender and
 *   number for a noun, the same ending for an adjective), so only the meaning tells them apart. Words the
 *   learner met before come first. Never a word of the same concept (a second right answer), never a
 *   homophone, never a word already in the sentence, never one that the article before the gap rules out.
 */

let lefff: FrenchVerbs | null = null;
const frenchData = (root: string) => (lefff ??= JSON.parse(readFileSync(join(root, "node_modules", "french-verbs-lefff", "dist", "conjugations.json"), "utf8")) as FrenchVerbs);

const FRENCH_TENSES: frenchVerbs.Tense[] = ["PRESENT", "IMPARFAIT", "FUTUR", "CONDITIONNEL_PRESENT", "SUBJONCTIF_PRESENT", "PASSE_SIMPLE"];

/** Conjugated forms of a verb, grouped: each group is one tense's six persons (or the participles). */
export function verbFormGroups(language: string, lemma: string, root = process.cwd()): { name: string; forms: string[] }[] {
  const verb = bareLemma(lemma);
  const groups: { name: string; forms: string[] }[] = [];
  if (language === "fr") {
    const data = frenchData(root);
    if (!(verb in data)) return [];
    const get = (tense: frenchVerbs.Tense, person: number, options: frenchVerbs.ComposedTenseOptions = {}) => {
      try {
        return frenchVerbs.getConjugation(data, verb, tense, person, options, false, undefined, undefined, "Act");
      } catch {
        return "";
      }
    };
    for (const tense of FRENCH_TENSES) groups.push({ name: tense, forms: [0, 1, 2, 3, 4, 5].map((person) => get(tense, person)) });
    const participles = (["M", "F"] as const).flatMap((agreeGender) => (["S", "P"] as const).map((agreeNumber) => get("PARTICIPE_PASSE", 0, { agreeGender, agreeNumber })));
    groups.push({ name: "PARTICIPE", forms: participles });
    groups.push({ name: "INFINITIF", forms: [verb] });
  } else {
    const info = germanVerb(verb, { root, weak: true })?.entry;
    if (!info) return [];
    const cell = (value: unknown) => (Array.isArray(value) ? String(value[0]) : String(value ?? ""));
    for (const tense of ["PRÄ", "PRT", "KJ2", "KJ1"]) {
      const table = info[tense] as { S: Record<string, unknown>; P: Record<string, unknown> } | undefined;
      if (table) groups.push({ name: tense, forms: ["S", "P"].flatMap((number) => ["1", "2", "3"].map((person) => cell((table as Record<string, Record<string, unknown>>)[number][person]))) });
    }
    groups.push({ name: "PA2", forms: (info.PA2 as string[] | undefined) ?? [] });
    groups.push({ name: "INF", forms: [verb] });
  }
  return groups.map((group) => ({ ...group, forms: group.forms.filter(Boolean) }));
}

/** Other forms of the same verb that are wrong where this form stands. */
export function verbDistractors(language: string, lemma: string, surface: string, root = process.cwd()): string[] {
  const groups = verbFormGroups(language, lemma, root);
  const right = fold(surface);
  const holding = groups.filter((group) => group.forms.some((form) => fold(form) === right));
  if (holding.length === 0) return [];
  const out: string[] = [];
  const push = (form: string | undefined) => {
    if (form && fold(form) !== right && !out.some((item) => fold(item) === fold(form))) out.push(form);
  };
  const participle = holding.some((group) => group.name === "PARTICIPE" || group.name === "PA2");
  if (participle) {
    // After an auxiliary: the infinitive and finite forms are wrong, other agreements may not be.
    const present = groups.find((group) => group.name === "PRESENT" || group.name === "PRÄ")?.forms ?? [];
    const past = groups.find((group) => group.name === "IMPARFAIT" || group.name === "PRT")?.forms ?? [];
    push(groups.find((group) => group.name === "INFINITIF" || group.name === "INF")?.forms[0]);
    push(present[2]);
    push(past[2]);
    push(present[5]);
    return out.slice(0, 3);
  }
  // Other persons of the same tense first, then the same person in another tense.
  const main = holding[0];
  const persons = main.forms.map((form, index) => (fold(form) === right ? index : -1)).filter((index) => index >= 0);
  for (const form of main.forms) push(form);
  for (const group of groups) if (group !== main && group.forms.length === 6) for (const index of persons) push(group.forms[index]);
  return out.slice(0, 3);
}

const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

const VOWEL = /^[aeiouyàâäéèêëîïôöùûüœæh]/iu;

/** The gap's surroundings that limit which forms fit. */
export type GapContext = {
  sentence: string;
  /** Words of the sentence (they are never wrong options). */
  used: Set<PackWord>;
  /** The token right before the gap. */
  before: string | null;
  /** Is the gap the first word of the sentence (a capital)? */
  first: boolean;
  /** The order a learner meets words in: candidates met before the target come first. */
  knownBefore: (word: PackWord) => boolean;
  level: string;
};

/** The form of another word that matches the target's form in the gap, or null when it cannot be made. */
function matchingForm(morph: Morph, language: string, target: PackWord, surface: string, other: PackWord): string | null {
  const word = target.word;
  const lemma = word.lemma;
  // A French adjective takes the gap's gender and number, read from Lexique: «jaune» has no gender
  // (any «s» adjective fits), «vert» is masculine (a masculine or genderless form fits).
  if (word.pos === "adj" && language === "fr") {
    const reading = morph.frenchReadings(surface).find((item) => fold(item.lemma) === fold(lemma) && item.tag === "ADJ");
    return reading ? morph.frenchForm(other.word.lemma, "ADJ", reading.gn) : fold(surface) === fold(lemma) ? other.word.lemma : null;
  }
  if (fold(surface) === fold(lemma)) return other.word.lemma;
  if (word.pos === "noun") {
    const plural = (item: PackWord) => item.word.plural ?? (language === "fr" ? morph.frenchForm(item.word.lemma, "NOM", `${item.word.gender === "mf" ? "m" : item.word.gender}p`) : null);
    const mine = plural(target);
    if (mine && fold(surface) === fold(mine)) return other.word.number === "sg_only" || other.word.number === "pl_only" ? null : plural(other);
    // German dative plural: Kindern.
    if (language === "de" && word.plural && fold(surface) === fold(`${word.plural}n`)) {
      const form = plural(other);
      return form && !/[ns]$/.test(form) ? `${form}n` : form;
    }
    return null;
  }
  if (word.pos === "adj") {
    const mine = germanAdjectiveForms(lemma).find((item) => fold(item.form) === fold(surface));
    if (!mine) return null;
    return germanAdjectiveForms(other.word.lemma).find((item) => item.ending === mine.ending && item.degree === mine.degree)?.form ?? null;
  }
  return null;
}

/**
 * Three wrong options for the gap holding `surface` (a form of `target`), or an explanation of why
 * the author must write them.
 */
export function autoDistractors(morph: Morph, words: PackWord[], target: PackWord, surface: string, context: GapContext): { options: string[]; hint: string | null } | { error: string } {
  const language = morph.language;
  const word = target.word;
  if (word.pos === "verb" && fold(surface) !== fold(word.lemma)) {
    const options = verbDistractors(language, word.lemma, surface);
    if (options.length < 3) return { error: `cannot make three other forms of «${word.lemma}» for «${surface}»: write d: a, b, c` };
    return { options, hint: `(${bareLemma(word.lemma)})` };
  }
  const homophones = new Set([...word.homophones.map(fold), fold(word.lemma)]);
  const right = fold(surface);
  const before = context.before ? fold(context.before) : null;
  const pool: { item: PackWord; form: string; tier: number; key: number }[] = [];
  for (const item of words) {
    const other = item.word;
    if (item === target || other.pos !== word.pos || other.no_card || !isCardRegister(other.register)) continue;
    if (levelRank(item.level) > levelRank(context.level) || context.used.has(item)) continue;
    if (other.concept_fa === word.concept_fa || fold(other.lemma) === fold(word.lemma) || homophones.has(fold(other.lemma)) || other.homophones.map(fold).includes(fold(word.lemma))) continue;
    if (word.pos === "noun" && other.gender !== word.gender) continue;
    if (word.pos === "phrase" && other.pos !== "phrase") continue;
    let form = matchingForm(morph, language, target, surface, item);
    if (!form || fold(form) === right) continue;
    // French elision: after l', d', qu' only a vowel or h; after le, de, que, je only a consonant.
    if (language === "fr" && before) {
      if (/'$/.test(before) && !VOWEL.test(form)) continue;
      if (/^(le|la|de|ce|je|me|te|se|ne|que|si)$/.test(before) && VOWEL.test(form)) continue;
    }
    if (context.first) form = form.charAt(0).toUpperCase() + form.slice(1);
    const sameTopic = item.topic === target.topic;
    const known = context.knownBefore(item);
    const tier = sameTopic && known ? 0 : sameTopic ? 1 : known ? 2 : 3;
    pool.push({ item, form, tier, key: hash(`${context.sentence}|${other.code}`) });
  }
  pool.sort((a, b) => a.tier - b.tier || a.key - b.key);
  const options: string[] = [];
  for (const entry of pool) {
    if (options.some((option) => fold(option) === fold(entry.form))) continue;
    options.push(entry.form);
    if (options.length === 3) break;
  }
  if (options.length < 3) return { error: `only ${options.length} wrong options of the same kind and form for «${surface}»: write d: a, b, c` };
  return { options, hint: null };
}
