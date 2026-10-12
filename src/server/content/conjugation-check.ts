import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as frenchVerbs from "french-verbs";
import type { VerbsInfo as FrenchVerbs } from "french-verbs-lefff";
import * as germanVerbs from "german-verbs";
import type { VerbsInfo as GermanVerbs } from "german-verbs-dict";
import { fold } from "@/engine/tokens";
import { pronounKeys } from "@/schemas/conjugation";
import type { LanguageCode } from "./languages";

/**
 * The second source for conjugation tables (PRD §13.4 step 5, §16.2): open conjugation data for each
 * language (French from the Lefff, German from Morphy via german-pos-dict). A table the chatbot made
 * is compared with it so the teacher only has to look closely at the tables that differ.
 */

type Persons = 1 | 2 | 3;
type Numbers = "S" | "P";
/** One way of conjugating (an auxiliary, a tense code): the acceptable forms for each of the six persons. */
type Reading = Set<string>[];

const frenchTenses: Record<string, frenchVerbs.Tense[]> = {
  présent: ["PRESENT"],
  "passé composé": ["PASSE_COMPOSE"],
  imparfait: ["IMPARFAIT"],
  "futur simple": ["FUTUR"],
  "passé simple": ["PASSE_SIMPLE"],
  "conditionnel présent": ["CONDITIONNEL_PRESENT"],
  "plus-que-parfait": ["PLUS_QUE_PARFAIT"],
  "subjonctif présent": ["SUBJONCTIF_PRESENT"],
  "conditionnel passé": ["CONDITIONNEL_PASSE_1"],
  "futur antérieur": ["FUTUR_ANTERIEUR"],
  "subjonctif passé": ["SUBJONCTIF_PASSE"],
};

/** "Konjunktiv II" is the one-word form (käme, hätte) or the würde form; both are right. */
const germanTenses: Record<string, string[]> = {
  präsens: ["PRASENS"],
  perfekt: ["PERFEKT"],
  präteritum: ["PRATERITUM"],
  "futur i": ["FUTUR1"],
  "futur ii": ["FUTUR2"],
  plusquamperfekt: ["PLUSQUAMPERFEKT"],
  "konjunktiv i": ["KONJUNKTIV1_PRASENS"],
  "konjunktiv ii": ["KONJUNKTIV2_PRATERITUM", "KONJUNKTIV2_FUTUR1"],
  "konjunktiv ii vergangenheit": ["KJ2_PAST"],
};

const germanPersons: [Persons, Numbers][] = [
  [1, "S"],
  [2, "S"],
  [3, "S"],
  [1, "P"],
  [2, "P"],
  [3, "P"],
];

const clean = (text: string) => fold(text).replace(/\s+/g, " ").trim();

let french: FrenchVerbs | null = null;
let german: GermanVerbs | null = null;

function data<T>(path: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "node_modules", path), "utf8")) as T;
}

/** Forms the Lefff gets wrong or leaves out: added to what it gives (person index, then forms). */
const frenchExtra: Record<string, Partial<Record<frenchVerbs.Tense, Record<number, string[]>>>> = {
  pouvoir: { PRESENT: { 0: ["peux"] } },
};

function frenchReadings(verb: string, tense: string): Reading[] | null {
  const codes = frenchTenses[tense];
  if (!codes) return null;
  french ??= data<FrenchVerbs>("french-verbs-lefff/dist/conjugations.json");
  const verbs = french;
  if (!(verb in verbs) && !/^(se |s')/.test(verb)) return null;
  const pronominal = /^(se |s')/.test(verb);
  const readings: Reading[] = [];
  for (const code of codes) {
    if (!frenchVerbs.isComposedTense(code)) {
      readings.push(
        [0, 1, 2, 3, 4, 5].map(
          (person) =>
            new Set([
              clean(frenchVerbs.getConjugation(verbs, verb, code, person, {}, false, undefined, undefined, "Act")),
              ...(frenchExtra[verb]?.[code]?.[person] ?? []),
            ]),
        ),
      );
      continue;
    }
    const auxes: frenchVerbs.FrenchAux[] = pronominal || frenchVerbs.alwaysAuxEtre(verb) ? ["ETRE"] : ["AVOIR", "ETRE"];
    for (const aux of auxes) {
      // With être the participle agrees with the subject, so every gender and number is right.
      const agreements: frenchVerbs.ComposedTenseOptions[] =
        aux === "ETRE"
          ? (["M", "F"] as const).flatMap((agreeGender) => (["S", "P"] as const).map((agreeNumber) => ({ aux, agreeGender, agreeNumber })))
          : [{ aux }];
      readings.push(
        [0, 1, 2, 3, 4, 5].map(
          (person) =>
            new Set(agreements.map((options) => clean(frenchVerbs.getConjugation(verbs, verb, code, person, options, false, undefined, undefined, "Act")))),
        ),
      );
    }
  }
  return readings;
}

function germanReadings(verb: string, tense: string): Reading[] | null {
  const codes = germanTenses[tense];
  if (!codes) return null;
  german ??= data<GermanVerbs>("german-verbs-dict/dist/verbs.json");
  const verbs = german;
  const bare = verb.replace(/^sich /, "");
  if (!(bare in verbs)) return null;
  const auxes: germanVerbs.GermanAux[] = germanVerbs.alwaysUsesSein(bare) ? ["SEIN"] : ["HABEN", "SEIN"];
  const readings: Reading[] = [];
  for (const code of codes) {
    for (const aux of auxes) {
      readings.push(
        germanPersons.map(([person, number]) => {
          const parts =
            code === "KJ2_PAST"
              ? [...germanVerbs.getConjugation(verbs, aux === "SEIN" ? "sein" : "haben", "KONJUNKTIV2_PRATERITUM", person, number, undefined, false, undefined), germanVerbs.getPartizip2(verbs, bare)]
              : germanVerbs.getConjugation(verbs, verb, code, person, number, aux, undefined, "ACCUSATIVE");
          return new Set([clean(parts.join(" "))]);
        }),
      );
    }
  }
  return readings;
}

export type SecondSource =
  | { result: "same" }
  | { result: "unknown" }
  | { result: "differs"; persons: { key: string; given: string; expected: string }[] };

/**
 * Compares a table with the second source. The forms (or any accepted variant) of all six persons
 * must match one reading; the closest reading names the persons that differ.
 */
export function compareTable(
  language: LanguageCode,
  verb: string,
  tense: string,
  forms: Record<string, string>,
  variants: Record<string, string[]>,
): SecondSource {
  let readings: Reading[] | null = null;
  try {
    readings = language === "fr" ? frenchReadings(verb, fold(tense)) : germanReadings(verb, fold(tense));
  } catch {
    readings = null;
  }
  if (!readings || readings.length === 0) return { result: "unknown" };

  const keys = pronounKeys[language];
  let best: SecondSource & { result: "differs" } = { result: "differs", persons: [] };
  let bestMisses = Infinity;
  for (const reading of readings) {
    const persons = keys
      .map((key, index) => {
        const given = [forms[key] ?? "", ...(variants[key] ?? [])].map(clean);
        const expected = reading[index];
        return given.some((form) => expected.has(form)) ? null : { key, given: forms[key] ?? "", expected: [...expected][0] };
      })
      .filter((person) => person !== null);
    if (persons.length === 0) return { result: "same" };
    if (persons.length < bestMisses) {
      bestMisses = persons.length;
      best = { result: "differs", persons };
    }
  }
  return best;
}
