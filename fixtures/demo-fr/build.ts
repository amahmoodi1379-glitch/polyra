/**
 * Turns the hand-written demo into the answers the panel's importers take (PRD §14): P-U for the
 * unit list, P-W for the words, P-X for the tables, P-S for the bank sentences and one P-G per unit.
 * Word mappings and wrong options are made here from the word list, so the data files stay short.
 * Pure: no database.
 */
import { units, type UnitDef } from "./grammar";
import { sentences } from "./sentences";
import { cardWords, names, persons, smallWords, verbs, type CardWord, type Person, type Slot } from "./words";

export const DEMO_VERSION = "demo-1";
export const DEMO_MODEL = "demo";
const LEVEL = "A1";

type Token = { surface: string; kind: "word" | "name" | "number"; code: string | null; meaning_fa: string | null };
type Form = { code: string; slot?: Slot | "sg" | "pl"; persons?: Person[]; infinitive?: boolean };

const ZWNJ = "‌";
const lower = (text: string) => text.normalize("NFC").toLocaleLowerCase("fr").replace(/’/g, "'");
const firstMeaning = (meaning: string) => meaning.split(/[،,]/)[0].trim();
const cardByCode = new Map(cardWords.map((word) => [word.code, word]));
const smallByCode = new Map(smallWords.map((word) => [word.code, word]));
const elided: Record<string, string> = { "j'": "je", "l'": "le", "c'": "ce", "n'": "ne", "d'": "de" };
const extraSmall: Record<string, string> = { une: "un" };

/** Every written form of the demo's words, lower case, with what it is. */
function formIndex(): Map<string, Form> {
  const index = new Map<string, Form>();
  const add = (surface: string, form: Form) => {
    const key = lower(surface);
    if (!index.has(key)) index.set(key, form);
  };
  for (const word of cardWords) {
    if (word.pos === "noun") {
      add(word.code, { code: word.code, slot: "sg" });
      if (word.plural) add(word.plural, { code: word.code, slot: "pl" });
    } else if (word.pos === "adj") {
      for (const slot of ["ms", "fs", "mp", "fp"] as Slot[]) add(word.forms[slot], { code: word.code, slot });
    } else if (word.pos === "verb") {
      add(word.code, { code: word.code, infinitive: true });
      const table = verbs[word.code];
      table.forms.forEach((form, i) => {
        const key = lower(form);
        const known = index.get(key);
        if (known && known.code === word.code) known.persons = [...(known.persons ?? []), persons[i]];
        else add(form, { code: word.code, persons: [persons[i]] });
      });
    } else add(word.code, { code: word.code });
  }
  for (const word of smallWords) add(word.code, { code: word.code });
  for (const [surface, code] of [...Object.entries(elided), ...Object.entries(extraSmall)]) add(surface, { code });
  return index;
}
const forms = formIndex();

/** Pieces of a sentence as the mapping check splits them (PRD §14.1), keeping an elided word's apostrophe. */
export function pieces(text: string): string[] {
  return [...text.replace(/’/g, "'").matchAll(/[\p{L}\p{M}]+'?|\p{Nd}+/gu)].map((match) => match[0]);
}

const subjects: Record<string, Person> = { je: "je", "j'": "je", tu: "tu", il: "il_elle_on", elle: "il_elle_on", nous: "nous", vous: "vous", ils: "ils_elles", elles: "ils_elles" };

/** The Persian of a verb form in this sentence: person from the form, else from the subject before it. */
function verbMeaning(code: string, form: Form, before: string[], negative: boolean): string {
  const word = cardByCode.get(code)!;
  if (form.infinitive) return firstMeaning(word.meaning);
  let person = form.persons![0];
  if (form.persons!.length > 1) {
    const subject = [...before].reverse().find((piece) => subjects[lower(piece)]);
    const wanted = subject ? subjects[lower(subject)] : "il_elle_on";
    person = form.persons!.includes(wanted) ? wanted : form.persons![0];
  }
  const i = persons.indexOf(person);
  const fa = verbs[code].fa;
  if ("yes" in fa) return (negative ? fa.no : fa.yes)[i];
  const ending = ["م", "ی", "د", "یم", "ید", "ند"][i];
  const head = fa.plain ? (negative ? "ن" : "") : negative ? `نمی${ZWNJ}` : `می${ZWNJ}`;
  return `${fa.prefix ?? ""}${head}${fa.stem}${ending}`;
}

/** The word mapping of a sentence (PRD §14.1 rule 10) with each word's meaning in this sentence. */
export function tokensOf(text: string, meanings: Record<string, string> = {}): Token[] {
  const list = pieces(text);
  const negative = list.some((piece) => lower(piece) === "pas");
  return list.map((surface, i) => {
    if (/^\p{Nd}+$/u.test(surface)) return { surface, kind: "number", code: null, meaning_fa: surface };
    if (names.includes(surface)) return { surface, kind: "name", code: null, meaning_fa: null };
    const key = lower(surface);
    const form = forms.get(key);
    if (!form) throw new Error(`Demo: «${surface}» in «${text}» is not a demo word`);
    const own = meanings[key];
    if (own) return { surface, kind: "word", code: form.code, meaning_fa: own };
    const small = smallByCode.get(form.code);
    if (small) return { surface, kind: "word", code: form.code, meaning_fa: firstMeaning(small.meaning) };
    const word = cardByCode.get(form.code)!;
    let meaning = firstMeaning(word.meaning);
    if (word.pos === "verb") meaning = verbMeaning(word.code, form, list.slice(0, i), negative);
    else if (word.pos === "noun" && form.slot === "pl") meaning = `${meaning}${ZWNJ}ها`;
    return { surface, kind: "word", code: form.code, meaning_fa: meaning };
  });
}

// ───────────────────────────── wrong options ─────────────────────────────

const orderOf = new Map(cardWords.map((word, i) => [word.code, i]));
const nearest = <T extends CardWord>(code: string, list: T[]): T[] => {
  const at = orderOf.get(code)!;
  // Words met just before come first, so the options are usually words the learner has seen.
  return [...list].sort((a, b) => {
    const da = orderOf.get(a.code)! - at;
    const db = orderOf.get(b.code)! - at;
    return (da < 0 ? -da : 1000 + da) - (db < 0 ? -db : 1000 + db);
  });
};

/** Three wrong options for a word target, in the same form as the blank: another noun, adjective or verb. */
export function wordDistractors(surface: string): string[] {
  const form = forms.get(lower(surface));
  if (!form) throw new Error(`Demo: no word for target «${surface}»`);
  const word = cardByCode.get(form.code)!;
  const cased = (text: string) => (/^\p{Lu}/u.test(surface) ? text[0].toLocaleUpperCase("fr") + text.slice(1) : text);
  const taken = new Set([lower(surface)]);
  const out: string[] = [];
  const push = (text: string | null | undefined) => {
    if (!text || out.length >= 3 || taken.has(lower(text))) return;
    taken.add(lower(text));
    out.push(cased(text));
  };
  if (word.pos === "noun") {
    const nouns = cardWords.filter((other): other is Extract<CardWord, { pos: "noun" }> => other.pos === "noun" && other.code !== word.code && other.kind !== "language");
    const shape = (other: (typeof nouns)[number]) => (form.slot === "pl" ? other.plural : other.code);
    for (const other of nearest(
      word.code,
      nouns.filter((other) => other.gender === word.gender && other.kind === word.kind),
    ))
      push(shape(other));
    for (const other of nearest(
      word.code,
      nouns.filter((other) => other.gender === word.gender),
    ))
      push(shape(other));
    for (const other of nearest(word.code, nouns)) push(shape(other));
  } else if (word.pos === "adj") {
    const slot = form.slot as Slot;
    const adjectives = cardWords.filter((other): other is Extract<CardWord, { pos: "adj" }> => other.pos === "adj" && other.code !== word.code);
    const sameFamily = adjectives.filter((other) => (other.family ?? null) === (word.family ?? null));
    for (const other of nearest(word.code, [...sameFamily, ...adjectives])) push(other.forms[slot]);
  } else if (word.pos === "verb") {
    const others = cardWords.filter((other) => other.pos === "verb" && other.code !== word.code);
    if (form.infinitive) for (const other of nearest(word.code, others)) push(other.code);
    else {
      const person = persons.indexOf(form.persons![0]);
      for (const other of nearest(word.code, others)) push(verbs[other.code].forms[person]);
    }
  } else {
    const small = cardWords.filter((other) => (other.pos === "adv" || other.pos === "interj") && other.code !== word.code);
    for (const other of nearest(word.code, small)) push(other.code);
  }
  if (out.length < 3) throw new Error(`Demo: too few wrong options for «${surface}»`);
  return out;
}

// ───────────────────────────── answers ─────────────────────────────

const blankPattern = /\[([^\]]+)\]/g;

export function wordsAnswer() {
  const card = cardWords.map((word) => ({
    code: word.code,
    lemma: word.code,
    pos: word.pos,
    gender: word.pos === "noun" ? word.gender : null,
    number: word.pos === "noun" ? "sg" : null,
    plural: word.pos === "noun" ? word.plural : null,
    meaning_fa: word.meaning,
    level: LEVEL,
    register: "standard",
    concept_fa: firstMeaning(word.meaning),
    no_card: false,
    homophones: word.homophones ?? [],
    note_fa: word.note ?? null,
    mastery: "produce",
    sense_of: null,
    parts: null,
    family: word.family ?? null,
    collocations: word.collocations ?? [],
  }));
  const small = smallWords.map((word) => ({
    code: word.code,
    lemma: word.code,
    pos: word.pos,
    gender: null,
    number: null,
    plural: null,
    meaning_fa: word.meaning,
    level: LEVEL,
    register: "standard",
    concept_fa: `${word.code}: ${firstMeaning(word.meaning)}`,
    no_card: true,
    homophones: [],
    note_fa: null,
    mastery: "produce",
    sense_of: null,
    parts: null,
    family: null,
    collocations: [],
  }));
  return { words: [...card, ...small], issues: [] };
}

export function unitListAnswer() {
  return { units: units.map((unit) => ({ unit_code: unit.code, title_fa: unit.title, level: LEVEL, scope_fa: unit.scope, can_do_fa: unit.canDo })), issues: [] };
}

export function tablesAnswer() {
  const tables = Object.entries(verbs)
    .filter(([, table]) => table.unit)
    .map(([verb, table]) => ({
      verb,
      tense: "présent",
      unit_code: table.unit,
      forms: Object.fromEntries(persons.map((person, i) => [person, table.forms[i]])),
      accepted_variants: {},
      review_card: table.review,
    }));
  return { tables, issues: [] };
}

export function sentencesAnswer() {
  return {
    sentences: sentences.map(([marked, translation, meanings]) => {
      const text = marked.replace(blankPattern, "$1");
      const targets = [...marked.matchAll(blankPattern)].map((match) => {
        const surface = match[1];
        const form = forms.get(lower(surface))!;
        // Only this occurrence is blank; the others stay as written.
        const start = match.index;
        const before = marked.slice(0, start).replace(blankPattern, "$1");
        const after = marked.slice(start + match[0].length).replace(blankPattern, "$1");
        return {
          type: "word",
          target: form.code,
          marked_text: `${before}{{${surface}}}${after}`,
          blanks: 1,
          accepted: [surface],
          distractors: wordDistractors(surface),
          hint: null,
          accepted_full: null,
        };
      });
      return { text, tts_text: null, translation_fa: translation, tokens: tokensOf(text, meanings), targets };
    }),
    issues: [],
  };
}

const grammarBlank = /\{\{(.*?)\}\}/g;

export function grammarAnswer(unit: UnitDef) {
  return {
    unit: {
      unit_code: unit.code,
      title_fa: unit.title,
      level: LEVEL,
      lesson_fa: unit.lesson,
      build_table: unit.table,
      example_sentences: unit.examples.map((example) => ({ text: example.text, tts_text: null, translation_fa: example.fa, tokens: tokensOf(example.text, example.meanings) })),
      rule_line_fa: unit.rule,
      common_mistake_fa: unit.mistake,
      category_sets: unit.sets ?? null,
      can_do_fa: unit.canDo,
    },
    targets: unit.targets.map((target) => {
      const text = target.text.replace(grammarBlank, "$1");
      const blanks = [...target.text.matchAll(grammarBlank)].map((match) => match[1]);
      const two = blanks.length === 2;
      return {
        sentence: { text, tts_text: null, translation_fa: target.fa, tokens: tokensOf(text, target.meanings) },
        marked_text: target.text,
        blanks: blanks.length,
        accepted: two ? blanks.map((blank) => [blank]) : [blanks[0]],
        distractors: target.distractors,
        hint: target.hint ?? null,
        accepted_full: null,
      };
    }),
    transforms: unit.transforms.map((item) => ({ instruction_fa: item.instruction, source: item.source, accepted_outputs: item.outputs })),
    translations: unit.translations.map((item) => ({ prompt_fa: item.fa, accepted_outputs: item.outputs, tokens: tokensOf(item.outputs[0], item.meanings) })),
    issues: [],
  };
}

export { units as demoUnits };
