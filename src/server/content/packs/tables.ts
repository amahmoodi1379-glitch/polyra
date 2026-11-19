import { fold } from "@/engine/tokens";
import { isCardRegister } from "@/engine/content";
import { pronounKeys } from "@/schemas/conjugation";
import { germanUsesSein, standardTable, type StandardTable } from "../conjugation-check";
import { levelRank, type LanguageCode } from "../languages";
import { germanVerb, germanWeak } from "../german-verbs";
import type { TableLink } from "./grammar";
import type { PackWord } from "./words";

/**
 * Conjugation tables of the content packs (P-X, PRD §6.6), built from the open data (owner, 18 Nov
 * 2026), never written by hand. Every verb of the lists gets every tense of its level and below
 * (`conjugation.tenses.<language>`); a lower-level verb gets the higher tenses at their level.
 *
 * A table belongs to the grammar unit that teaches its tense: a unit says so with `tables: <tense>`,
 * or `tables: <tense> | <class>` for one class of verbs (a lemma such as «avoir», or one of the classes
 * below). The most specific unit at or below the table's level wins.
 *
 * `review_card` (PRD §6.6: «usually irregular verbs and one to three sample verbs of each group»): a verb
 * whose forms in that tense do not follow its group's pattern, and the first verb of each group in
 * teaching order of each regular group (and its reflexive, separable or «être» kind) as its sample.
 */

export const VERB_CLASSES = {
  fr: ["er", "ir", "irregular", "reflexive", "aux-etre"],
  de: ["regular", "irregular", "modal", "separable", "reflexive", "aux-sein"],
} as const;

export type PackTable = {
  verb: PackWord;
  tense: string;
  /** The level the table is taught at: the verb's, the tense's or its unit's, whichever is highest. */
  level: string;
  unit_code: string;
  forms: Record<string, string>;
  accepted_variants: Record<string, string[]>;
  review_card: boolean;
};
type Note = { file: string; line: number; text: string };
export type UnitTables = { unit_code: string; level: string; order: number; file: string; tables: TableLink[] };
export type BuiltTables = { tables: PackTable[]; errors: Note[]; warnings: Note[]; notes: Note[] };

const GERMAN_MODALS = new Set(["können", "müssen", "dürfen", "sollen", "wollen", "mögen", "möchten"]);
const GERMAN_STRONG_MOOD = new Set(["sein", "haben", "werden", "wissen", ...GERMAN_MODALS]);
/** Tenses built from an auxiliary and a form taught before: only the sample verbs get a card. */
const DERIVED = new Set(["plus-que-parfait", "conditionnel passe", "futur anterieur", "subjonctif passe", "futur i", "futur ii", "plusquamperfekt", "konjunktiv ii vergangenheit"]);
/** Tenses built with the auxiliary «être»/«sein» or «avoir»/«haben». */
const COMPOSED = new Set(["passe compose", "plus-que-parfait", "conditionnel passe", "futur anterieur", "subjonctif passe", "perfekt", "plusquamperfekt", "futur ii", "konjunktiv ii vergangenheit"]);

/** A tense name without case or accents (Präsens → prasens), to compare names. */
const tenseKey = (tense: string) => fold(tense).normalize("NFD").replace(/\p{M}/gu, "");
const bare = (lemma: string) => lemma.replace(/^(se |s'|sich )/u, "");
const strip = (form: string) => form.replace(/^(me |te |se |nous |vous |m'|t'|s')/u, "").replace(/ (mich|dich|sich|uns|euch|mir|dir)\b/u, "").trim();

/** French group: «er» (parler), «ir» (finir, nous finissons), else irregular. Aller is irregular. */
function frenchGroup(lemma: string, present: StandardTable | null): "er" | "ir" | "irregular" {
  const verb = bare(lemma);
  if (verb.endsWith("er") && verb !== "aller") return "er";
  if (verb.endsWith("ir") && present && strip(present.forms.nous) === `${verb.slice(0, -2)}issons`) return "ir";
  return "irregular";
}

/** The separable particle of a German verb in the dictionary (aufstehen → auf), or null. */
function germanParticle(verb: string, root?: string): string | null {
  const info = germanVerb(verb, { root, weak: true })?.entry as { hasPrefix?: boolean; PRÄ?: { S?: Record<string, [string, string] | string> } } | undefined;
  if (!info?.hasPrefix) return null;
  const first = Object.values(info.PRÄ?.S ?? {})[0];
  return Array.isArray(first) ? first[1] : null;
}

/** Does the verb follow its group's pattern in this tense? (No: it gets a review card.) */
function irregularIn(language: LanguageCode, lemma: string, tense: string, table: StandardTable, group: string, root?: string): boolean {
  const verb = bare(lemma);
  const keys = pronounKeys[language];
  const forms = keys.map((key) => strip(table.forms[key]));
  const name = tenseKey(tense);
  if (DERIVED.has(name)) return false;
  if (language === "fr") {
    const present = standardTable("fr", verb, "présent");
    const nous = present ? strip(present.forms.nous) : "";
    const ils = present ? strip(present.forms.ils_elles) : "";
    if (name === "passe compose") {
      const participle = forms[0].split(" ").pop() ?? "";
      return group === "irregular" || !(participle === `${verb.slice(0, -2)}${group === "er" ? "é" : "i"}`);
    }
    if (name === "imparfait") return forms[3] !== `${nous.replace(/ons$/, "")}ions`;
    if (name === "futur simple" || name === "conditionnel present") return !forms[0].startsWith(verb.replace(/e$/, ""));
    if (name === "subjonctif present") return forms[0] !== `${ils.replace(/ent$/, "")}e`;
    if (name === "present") {
      if (group === "irregular") return true;
      const model = group === "er" ? ["e", "es", "e", "ons", "ez", "ent"] : ["is", "is", "it", "issons", "issez", "issent"];
      const stem = verb.slice(0, -2);
      return forms.some((form, index) => fold(form) !== fold(stem + model[index]) && !(index === 0 && /^j'/.test(form)));
    }
    return group === "irregular";
  }
  const particle = germanParticle(verb, root);
  const base = particle && verb.startsWith(particle) ? verb.slice(particle.length) : verb;
  const plain = forms.map((form) => (particle ? form.replace(new RegExp(` ${particle}$`), "") : form));
  if (name === "konjunktiv ii" || name === "konjunktiv i") return GERMAN_STRONG_MOOD.has(base);
  const weak = germanWeak(base);
  const pastIrregular = () => {
    const past = standardTable("de", verb, "Präteritum");
    if (!past) return true;
    return keys.some((key, index) => fold(strip(past.forms[key]).replace(new RegExp(` ${particle ?? "$^"}$`), "")) !== fold(weak.past[index]));
  };
  if (name === "prasens") return GERMAN_STRONG_MOOD.has(base) || plain.some((form, index) => fold(form) !== fold(weak.present[index]));
  if (name === "prateritum") return pastIrregular();
  if (name === "perfekt") return germanUsesSein(verb) || pastIrregular();
  return GERMAN_STRONG_MOOD.has(base);
}

/** The classes a verb belongs to in a tense, most specific first (a unit may claim any of them). */
function classesOf(language: LanguageCode, lemma: string, tense: string, group: string, root?: string): string[] {
  const verb = bare(lemma);
  const out = [fold(lemma), fold(verb)];
  const composed = COMPOSED.has(tenseKey(tense));
  if (language === "fr") {
    if (/^(se |s')/u.test(lemma)) out.push("reflexive");
    if (composed && (/^(se |s')/u.test(lemma) || ["aller", "venir", "arriver", "partir", "entrer", "sortir", "rester", "tomber", "naître", "mourir", "devenir", "revenir", "retourner", "monter", "descendre", "passer"].includes(verb))) {
      out.push("aux-etre");
    }
  } else {
    if (GERMAN_MODALS.has(verb)) out.push("modal");
    if (/^sich /u.test(lemma)) out.push("reflexive");
    if (composed && germanUsesSein(verb)) out.push("aux-sein");
    if (germanParticle(verb, root)) out.push("separable");
  }
  out.push(group);
  return [...new Set(out)];
}

/**
 * The tables of the pack's verbs. `tenses` is `conjugation.tenses.<language>` (level → tenses);
 * `units` the grammar units of every level with their `tables:` lines.
 */
export function buildTables(language: LanguageCode, words: PackWord[], tenses: Record<string, string[]>, units: UnitTables[], root?: string): BuiltTables {
  const out: BuiltTables = { tables: [], errors: [], warnings: [], notes: [] };
  const levels = Object.keys(tenses).sort((a, b) => levelRank(a) - levelRank(b));
  const allowed = new Set<string>(VERB_CLASSES[language]);
  for (const unit of units) {
    for (const link of unit.tables) {
      if (!levels.some((level) => (tenses[level] ?? []).some((tense) => tenseKey(tense) === tenseKey(link.tense)))) {
        out.errors.push({ file: unit.file, line: 1, text: `tables: «${link.tense}» is not a tense of conjugation.tenses.${language} (${levels.flatMap((level) => tenses[level]).join(", ")})` });
      }
      if (link.verbClass && !allowed.has(link.verbClass) && !words.some((item) => fold(item.word.lemma) === fold(link.verbClass!) && item.word.pos === "verb")) {
        out.errors.push({ file: unit.file, line: 1, text: `tables: class «${link.verbClass}» is neither a verb of the lists nor one of ${[...allowed].join(", ")}` });
      }
    }
  }
  const verbs = words
    .filter((item) => item.word.pos === "verb" && !item.word.no_card && !item.word.sense_of && isCardRegister(item.word.register))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.order - b.order);
  const missingUnit = new Map<string, string>();
  const sampled = new Set<string>();
  for (const verb of verbs) {
    const present = standardTable(language, verb.word.lemma, language === "fr" ? "présent" : "Präsens");
    if (!present) {
      out.notes.push({ file: verb.file, line: verb.line, text: `«${verb.word.lemma}» is not in the conjugation data: no tables` });
      continue;
    }
    if (language === "de" && germanVerb(bare(verb.word.lemma), { root, weak: true })?.made === "weak") {
      out.warnings.push({ file: verb.file, line: verb.line, text: `«${verb.word.lemma}» is not in Morphy: its tables follow the regular pattern (${Object.values(present.forms).slice(0, 3).join(", ")} …); check them` });
    }
    const group = language === "fr" ? frenchGroup(verb.word.lemma, present) : null;
    for (const tenseLevel of levels) {
      for (const tense of tenses[tenseLevel] ?? []) {
        const table = standardTable(language, verb.word.lemma, tense);
        if (!table) {
          out.notes.push({ file: verb.file, line: verb.line, text: `no ${tense} of «${verb.word.lemma}» in the conjugation data` });
          continue;
        }
        const germanGroup = language === "de" ? (irregularIn("de", verb.word.lemma, "Präteritum", standardTable("de", verb.word.lemma, "Präteritum") ?? table, "", root) ? "irregular" : "regular") : null;
        const verbGroup = group ?? germanGroup ?? "regular";
        const classes = classesOf(language, verb.word.lemma, tense, verbGroup, root);
        const level = levelRank(verb.level) >= levelRank(tenseLevel) ? verb.level : tenseLevel;
        const ofTense = units.filter((unit) => unit.tables.some((link) => tenseKey(link.tense) === tenseKey(tense)));
        if (ofTense.length === 0) {
          missingUnit.set(tense, tenseLevel);
          continue;
        }
        const rank = (unit: UnitTables) => {
          const links = unit.tables.filter((link) => tenseKey(link.tense) === tenseKey(tense));
          const best = Math.min(...links.map((link) => (link.verbClass ? classes.indexOf(fold(link.verbClass)) : classes.length)).map((index) => (index < 0 ? Infinity : index)));
          return best;
        };
        const fitting = ofTense
          .map((unit) => ({ unit, rank: rank(unit) }))
          .filter((item) => item.rank < Infinity)
          .sort((a, b) => {
            const aBelow = levelRank(a.unit.level) <= levelRank(level) ? 0 : 1;
            const bBelow = levelRank(b.unit.level) <= levelRank(level) ? 0 : 1;
            return aBelow - bBelow || a.rank - b.rank || levelRank(a.unit.level) - levelRank(b.unit.level) || a.unit.order - b.unit.order;
          });
        const unit = fitting[0]?.unit ?? [...ofTense].sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.order - b.order)[0];
        const tableLevel = levelRank(unit.level) > levelRank(level) ? unit.level : level;
        const sampleKey = `${tenseKey(tense)}|${classes.filter((item) => allowed.has(item)).join("+")}`;
        const sample = verbGroup !== "irregular" && !sampled.has(sampleKey);
        if (sample) sampled.add(sampleKey);
        out.tables.push({
          verb,
          tense,
          level: tableLevel,
          unit_code: unit.unit_code,
          forms: table.forms,
          accepted_variants: germanVariants(language, tense, table),
          review_card: sample || irregularIn(language, verb.word.lemma, tense, table, verbGroup, root),
        });
      }
    }
  }
  // A level's tenses need a unit once that level has grammar; before, its tables wait.
  for (const [tense, tenseLevel] of missingUnit) {
    const text = `no grammar unit says «tables: ${tense}»: its tables have no unit`;
    if (units.some((unit) => unit.level === tenseLevel)) out.errors.push({ file: "grammar", line: 0, text });
    else out.notes.push({ file: "grammar", line: 0, text: `${text} (waits for the ${tenseLevel} grammar)` });
  }
  return out;
}

/** Konjunktiv forms with and without the -e- (kämest, kämst) are both right. */
function germanVariants(language: LanguageCode, tense: string, table: StandardTable): Record<string, string[]> {
  if (language !== "de" || !tenseKey(tense).startsWith("konjunktiv")) return table.variants;
  const variants: Record<string, string[]> = {};
  for (const [key, form] of Object.entries(table.forms)) {
    const list = [...(table.variants[key] ?? [])];
    const short = form.replace(/([^t])e(st|t)$/u, "$1$2");
    if (short !== form && /ä|ö|ü/.test(form) && !list.includes(short)) list.push(short);
    if (list.length) variants[key] = list;
  }
  return variants;
}
