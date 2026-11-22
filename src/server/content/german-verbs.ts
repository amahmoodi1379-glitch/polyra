import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerbsInfo } from "german-verbs-dict";

/**
 * Morphy's German verbs (german-verbs-dict) as the app uses them: in today's spelling (Morphy still writes
 * «muß», «läßt», «schloß»; the 1996 reform writes ss after a short vowel), with the persons it leaves out
 * filled by rule, and verbs it lacks made from their parts: a separable verb from its base (mitkommen from
 * kommen), and, only when asked, a verb with no entry at all by the regular pattern (frühstücken).
 */

type Entry = Record<string, unknown>;
type Table = { S?: Record<string, unknown>; P?: Record<string, unknown> };

/** Particles a German verb may be made of: the separable verbs Morphy may lack (mitkommen, wehtun). */
export const GERMAN_PARTICLES = [
  "ab", "an", "auf", "aus", "bei", "dabei", "dar", "durch", "ein", "entgegen", "fern", "fest", "fort", "her", "heraus", "herein", "herum",
  "herunter", "hin", "hinaus", "hinein", "hinunter", "kennen", "leid", "los", "mit", "nach", "nieder", "spazieren", "statt", "teil", "um",
  "vor", "voran", "vorbei", "weg", "weh", "weiter", "wieder", "zu", "zurecht", "zurück", "zusammen", "frei", "kaputt", "sauber",
];

const UMLAUT: Record<string, string> = { ä: "a", ö: "o", ü: "u" };
const plain = (text: string) => text.replace(/[äöü]/g, (letter) => UMLAUT[letter]);
const VOWEL = /[aeiouäöü]/;

/**
 * «ß» after a short vowel becomes «ss» (Rechtschreibreform 1996): «i» before ß is always short in a verb
 * (ißt, biß, wißt); another vowel is short when the verb's other forms have it before «ss» (muß: gemusst,
 * schloß: schlossen, läßt: lassen). A long vowel or a diphthong keeps ß (aß, weiß, ließ, stößt).
 */
export function modernSpelling(form: string, paradigm: string): string {
  return form.replace(/ß/g, (letter: string, at: number) => {
    const vowel = form[at - 1] ?? "";
    if (!VOWEL.test(vowel) || VOWEL.test(form[at - 2] ?? "")) return letter;
    return vowel === "i" || paradigm.includes(`${plain(vowel)}ss`) ? "ss" : letter;
  });
}

const collect = (value: unknown, out: string[]) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collect(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collect(item, out));
};
const mapForms = (value: unknown, change: (form: string) => string): unknown => {
  if (typeof value === "string") return change(value);
  if (Array.isArray(value)) return value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string" ? [change(value[0]), value[1]] : value.map((item) => mapForms(item, change));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapForms(item, change)]));
  return value;
};
/** A form with something added to its verb part (["kam", "mit"] + "st" → ["kamst", "mit"]). */
const extend = (value: unknown, change: (form: string) => string) => (Array.isArray(value) ? [change(String(value[0])), value[1]] : change(String(value)));
const verbPart = (value: unknown) => (Array.isArray(value) ? String(value[0]) : String(value ?? ""));

/** The persons Morphy leaves out, by rule; the third person plural is always the first (wir/sie). */
function fillPersons(entry: Entry) {
  for (const tense of ["PRÄ", "PRT", "KJ1", "KJ2"]) {
    const table = entry[tense] as Table | undefined;
    if (!table) continue;
    const S = (table.S ??= {});
    const P = (table.P ??= {});
    if (!S["1"] && S["3"] && tense !== "PRÄ") S["1"] = S["3"];
    if (!S["3"] && S["1"] && tense !== "PRÄ") S["3"] = S["1"];
    if (!P["1"] && P["3"]) P["1"] = P["3"];
    if (P["1"] && (!P["3"] || (tense !== "PRÄ" && verbPart(P["3"]) !== verbPart(P["1"])))) P["3"] = P["1"];
    if (!S["2"] && S["1"]) S["2"] = extend(S["1"], (form) => (tense === "PRT" && /[sßzxtd]$/.test(form) ? `${form}est` : `${form}st`));
    if (!P["2"] && S["1"] && tense !== "PRÄ") P["2"] = extend(S["1"], (form) => `${form}t`);
    if (!P["2"] && P["1"] && tense === "PRÄ") P["2"] = extend(P["1"], (form) => `${form.replace(/e?n$/, "")}t`);
  }
}

/** Regular (weak) German forms: stem + endings, with -e- after t, d and a consonant + m/n (arbeitest, atmest; not kommst). */
export function germanWeak(verb: string) {
  const stem = /(el|er)n$/.test(verb) ? verb.slice(0, -1) : verb.replace(/e?n$/, "");
  const extraE = /[td]$/.test(stem) || (/[mn]$/.test(stem) && /[^aeiouäöülrmnh]$|[^aeiouäöü]h$/.test(stem.slice(0, -1)));
  const t = extraE ? "et" : "t";
  return {
    stem,
    present: [/eln$/.test(verb) ? `${stem.slice(0, -2)}le` : `${stem}e`, extraE ? `${stem}est` : /[sßzx]$/.test(stem) ? `${stem}t` : `${stem}st`, `${stem}${t}`, verb, `${stem}${t}`, verb],
    past: ["e", "est", "e", "en", "et", "en"].map((ending) => `${stem}${t}${ending}`),
    participle: /^(be|ge|er|ver|zer|ent|emp|miss)/.test(verb) || /ieren$/.test(verb) ? `${stem}${t}` : `ge${stem}${t}`,
  };
}

const table6 = (forms: unknown[]): Table => ({ S: { 1: forms[0], 2: forms[1], 3: forms[2] }, P: { 1: forms[3], 2: forms[4], 3: forms[5] } });

function weakEntry(verb: string): Entry {
  const weak = germanWeak(verb);
  const kj1 = [`${weak.stem}e`, `${weak.stem}est`, `${weak.stem}e`, verb, `${weak.stem}et`, verb];
  return { INF: verb, PA1: `${verb}d`, PA2: [weak.participle], PRÄ: table6(weak.present), PRT: table6(weak.past), KJ1: table6(kj1), KJ2: table6(weak.past), IMP: { S: weak.present[0], P: weak.present[4] } };
}

/** A separable verb made from its base: every finite form takes the particle, the participle and zu-infinitive hold it. */
function compoundEntry(base: Entry, particle: string, verb: string): Entry {
  const out: Entry = { hasPrefix: true, INF: verb };
  for (const tense of ["PRÄ", "PRT", "KJ1", "KJ2"]) if (base[tense]) out[tense] = mapTable(base[tense] as Table, particle);
  out.PA2 = ((base.PA2 as string[] | undefined) ?? []).map((form) => `${particle}${form}`);
  if (base.PA1) out.PA1 = `${particle}${base.PA1}`;
  out.EIZ = `${particle}zu${String(base.INF ?? verb.slice(particle.length))}`;
  return out;
}
const mapTable = (table: Table, particle: string): Table => ({
  S: Object.fromEntries(Object.entries(table.S ?? {}).map(([person, form]) => [person, [verbPart(form), particle]])),
  P: Object.fromEntries(Object.entries(table.P ?? {}).map(([person, form]) => [person, [verbPart(form), particle]])),
});

let data: VerbsInfo | null = null;
const made = new Map<string, "compound" | "weak">();

/** Every verb of Morphy in today's spelling with its persons filled. */
export function germanVerbData(root = process.cwd()): VerbsInfo {
  if (data) return data;
  const raw = JSON.parse(readFileSync(join(root, "node_modules", "german-verbs-dict", "dist", "verbs.json"), "utf8")) as Record<string, Entry>;
  for (const [verb, entry] of Object.entries(raw)) {
    const forms: string[] = [verb];
    collect(entry, forms);
    const paradigm = plain(forms.join(" "));
    const modern = (forms.some((form) => form.includes("ß")) ? mapForms(entry, (form) => modernSpelling(form, paradigm)) : entry) as Entry;
    if (Array.isArray(modern.PA2)) modern.PA2 = [...new Set(modern.PA2 as string[])];
    fillPersons(modern);
    raw[verb] = modern;
  }
  // «möchten» is the Konjunktiv II of mögen, taught as a verb of its own with a present tense.
  if (raw["mögen"]?.KJ2 && !raw["möchten"]) raw["möchten"] = { INF: "möchten", PRÄ: raw["mögen"].KJ2 };
  data = raw as unknown as VerbsInfo;
  return data;
}

/**
 * A verb's entry, made from its parts when Morphy lacks it: a separable verb from its base, and with
 * `weak` a verb with no entry by the regular pattern. `made` says which, so the caller can ask for a check.
 */
export function germanVerb(verb: string, options: { root?: string; weak?: boolean } = {}): { entry: Entry; made: "compound" | "weak" | null } | null {
  const dict = germanVerbData(options.root) as unknown as Record<string, Entry>;
  const there = dict[verb];
  if (there && made.get(verb) === "weak" && !options.weak) return null;
  if (there) return { entry: there, made: made.get(verb) ?? null };
  const particle = GERMAN_PARTICLES.filter((item) => verb.startsWith(item) && verb.length - item.length >= 3 && dict[verb.slice(item.length)]).sort((a, b) => b.length - a.length)[0];
  if (particle) {
    dict[verb] = compoundEntry(dict[verb.slice(particle.length)], particle, verb);
    made.set(verb, "compound");
    return { entry: dict[verb], made: "compound" };
  }
  if (!options.weak || !/(e?n)$/.test(verb)) return null;
  dict[verb] = weakEntry(verb);
  made.set(verb, "weak");
  return { entry: dict[verb], made: "weak" };
}
