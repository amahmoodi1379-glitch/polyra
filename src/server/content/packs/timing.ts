/**
 * «Grammar before its lesson» (owner, 24 Nov 2026): a word's sentence should not lean on a grammar point
 * whose unit a learner meets only much later. The word lists only check words; this check looks for the
 * marks of a few grammar points (war/hatte, mir/dir, modal verbs, du pain, passé composé …) in each word
 * sentence, outside its gap, and names the sentences whose word comes before the unit that teaches it.
 *
 * When a unit comes is estimated from the engine's pace: grammar opens after `gate.grammar_words` card
 * words and then moves with vocabulary, so unit k of n at a level arrives about (k − 1) × (card words ÷ n)
 * words later. It is a warning for the writer, never an error: a chunk like «Wie geht es dir?» is fine early.
 *
 * The A2 points (weil, dass, the adjective endings, the Präteritum, the French object pronouns, imparfait,
 * futur simple …) are looked for only in the sentences of their own level's words: the A1 sentences were
 * written before these marks and a loaded sentence is not replaced from the files.
 */
import type { LanguageCode } from "../languages";
import type { PackWord } from "./words";

export type TimingToken = { surface: string; code: string | null; inGap: boolean };
export type TimingLine = { file: string; line: number; target: PackWord; text: string; tokens: TimingToken[] };
export type TimingUnit = { unit_code: string; level: string; order: number };
export type TimingNote = { file: string; line: number; word: string; wordIndex: number; unit: string; arrives: number; text: string };

/** What the marks may look at besides the tokens: the verbs, each word's part of speech, a tense's forms. */
export type TimingContext = {
  verbs: Set<string>;
  pos: Map<string, string>;
  /** A tense's verb forms (the verb word only: «levais» of «me levais», «kaufte» of «kaufte ein»). */
  tenseForms: Map<string, Set<string>>;
};

/** A grammar point's marks: word codes (any form), surfaces, two surfaces side by side, a tense's forms, or a rule. */
type Marker = {
  unit: string;
  label: string;
  codes?: string[];
  forms?: string[];
  pairs?: [string[], string[]];
  /** French passé composé: a form of avoir or être, then (after ne/pas/déjà …) a participle-shaped verb. */
  perfect?: boolean;
  /** Any form of this tense (`conjugation.tenses`), less the forms in `except`. */
  tense?: string;
  except?: string[];
  /** A rule on the token at `index` and its neighbours. */
  match?: (tokens: TimingToken[], index: number, context: TimingContext) => boolean;
};

const lower = (token: TimingToken | undefined) => token?.surface.toLowerCase() ?? "";
const isVerb = (token: TimingToken | undefined, context: TimingContext) => !!token?.code && context.verbs.has(token.code);
const posOf = (token: TimingToken | undefined, context: TimingContext) => (token?.code ? context.pos.get(token.code) : undefined);
/** «ne» or «n'» among the few tokens before `index`. */
const negatedBefore = (tokens: TimingToken[], index: number) => tokens.slice(Math.max(0, index - 4), index).some((token) => /^(ne|n')$/u.test(lower(token)));

const DE_DEFINITE = ["der", "die", "das", "dem", "den", "des", "dieser", "diese", "dieses", "diesem", "diesen", "jeder", "jede", "jedes", "jedem", "jeden", "welcher", "welche", "welches", "welchem", "welchen"];
const DE_INDEFINITE = /^(ein|kein|mein|dein|sein|ihr|unser|euer|eur|Ihr)(e|er|es|em|en)?$/iu;
/** A German adjective with an ending right before a noun (ein kleines Kind, mit dem alten Auto). */
const attributive = (tokens: TimingToken[], index: number, context: TimingContext) =>
  posOf(tokens[index], context) === "adj" && /(e|en|er|es|em)$/u.test(lower(tokens[index])) && !tokens[index + 1]?.inGap && posOf(tokens[index + 1], context) === "noun";
/** The article before an attributive adjective (one more adjective may stand between). */
const articleBefore = (tokens: TimingToken[], index: number, context: TimingContext) => {
  let at = index - 1;
  if (posOf(tokens[at], context) === "adj") at--;
  return tokens[at];
};
const FR_SUBJECTS = new Set(["je", "j'", "tu", "il", "ils", "elle", "elles", "on", "nous", "vous"]);
const FR_ETRE_PRESENT = ["suis", "es", "est", "sommes", "êtes", "sont"];
const DE_MODAL_PAST = ["wollte", "wolltest", "wollten", "wolltet", "konnte", "konntest", "konnten", "konntet", "musste", "musstest", "mussten", "musstet", "durfte", "durftest", "durften", "durftet", "mochte", "mochtest", "mochten", "mochtet"];
const DE_POLITE = ["hätte", "hättest", "hätten", "hättet", "würde", "würdest", "würden", "würdet", "könnte", "könntest", "könnten", "könntet", "wäre", "wärst", "wären", "wärt"];

const DE_DATIVE_ARTICLES = ["dem", "einem", "meinem", "deinem", "seinem", "ihrem", "unserem", "einer", "meiner", "deiner", "seiner", "ihrer", "unserer"];

export const TIMING_MARKERS: Record<LanguageCode, Marker[]> = {
  de: [
    { unit: "de-a1-vokalwechsel", label: "isst، sprichst، fährt", forms: ["isst", "sprichst", "spricht", "liest", "fährst", "fährt", "siehst", "sieht", "nimmst", "nimmt", "gibst", "weißt", "weiß"] },
    { unit: "de-a1-war-hatte", label: "war، hatte", forms: ["war", "warst", "waren", "wart", "hatte", "hattest", "hatten", "hattet"] },
    { unit: "de-a1-akkusativ", label: "einen، keinen", forms: ["einen", "keinen", "meinen", "deinen", "seinen", "unseren"] },
    { unit: "de-a1-personalpronomen-akkusativ", label: "mich، dich، ihn", forms: ["mich", "dich", "ihn"] },
    { unit: "de-a1-dativ-praepositionen", label: "mit dem، zu meinem", pairs: [["mit", "zu", "bei", "von"], DE_DATIVE_ARTICLES] },
    { unit: "de-a1-dativ-pronomen", label: "mir، dir، Ihnen", forms: ["mir", "dir", "ihm", "ihnen"] },
    { unit: "de-a1-moechten", label: "möchte", forms: ["möchte", "möchtest", "möchten", "möchtet"] },
    { unit: "de-a1-koennen", label: "kann، kannst", forms: ["kann", "kannst", "können", "könnt"] },
    { unit: "de-a1-muessen-wollen", label: "muss، will", forms: ["muss", "musst", "müssen", "müsst", "will", "willst", "wollen", "wollt"] },
    { unit: "de-a1-duerfen", label: "darf", forms: ["darf", "darfst", "dürfen", "dürft"] },
    { unit: "de-a2-reflexive-verben", label: "sich", codes: ["sich"] },
    { unit: "de-a2-weil", label: "weil", codes: ["weil"] },
    { unit: "de-a2-dass", label: "dass", codes: ["dass"] },
    {
      unit: "de-a2-adjektiv-bestimmt",
      label: "der kleine Hund",
      match: (tokens, index, context) => attributive(tokens, index, context) && DE_DEFINITE.includes(lower(articleBefore(tokens, index, context))),
    },
    {
      unit: "de-a2-adjektiv-unbestimmt",
      label: "ein kleiner Hund",
      match: (tokens, index, context) => attributive(tokens, index, context) && DE_INDEFINITE.test(lower(articleBefore(tokens, index, context))),
    },
    { unit: "de-a2-praeteritum-modal", label: "wollte، konnte، musste", forms: DE_MODAL_PAST },
    { unit: "de-a2-wenn", label: "wenn", codes: ["wenn"] },
    { unit: "de-a2-komparativ", label: "besser، lieber", forms: ["besser", "lieber"] },
    { unit: "de-a2-superlativ", label: "am besten", match: (tokens, index) => lower(tokens[index]) === "am" && /sten$/u.test(lower(tokens[index + 1])) && !tokens[index + 1]?.inGap },
    { unit: "de-a2-denn-deshalb-trotzdem", label: "deshalb، trotzdem", codes: ["deshalb", "trotzdem"] },
    { unit: "de-a2-werden", label: "wird، werde", match: (tokens, index) => tokens[index].code === "werden" && !/^würd/u.test(lower(tokens[index])) },
    { unit: "de-a2-indirekte-fragen", label: "ob", codes: ["ob"] },
    {
      unit: "de-a2-praeteritum-regelmaessig",
      label: "machte، ging",
      tense: "Präteritum",
      except: ["war", "warst", "waren", "wart", "hatte", "hattest", "hatten", "hattet", ...DE_MODAL_PAST, "sollte", "solltest", "sollten", "solltet"],
    },
    { unit: "de-a2-wechselpraepositionen", label: "legen، stellen، hängen", codes: ["legen", "stellen", "setzen", "hängen"] },
    {
      unit: "de-a2-adjektiv-ohne-artikel",
      label: "frischer Kaffee",
      match: (tokens, index, context) => {
        if (!attributive(tokens, index, context)) return false;
        const before = articleBefore(tokens, index, context);
        return !DE_DEFINITE.includes(lower(before)) && !DE_INDEFINITE.test(lower(before));
      },
    },
    { unit: "de-a2-sollen", label: "soll، sollte", codes: ["sollen"] },
    { unit: "de-a2-hoeflich", label: "hätte gern، würde، könnten", forms: DE_POLITE },
    { unit: "de-a2-sondern", label: "sondern", codes: ["sondern"] },
  ],
  fr: [
    { unit: "fr-a1-comparatif", label: "plus … que", pairs: [["plus", "moins", "aussi"], []] },
    { unit: "fr-a1-partitif", label: "du pain", codes: ["du"] },
    { unit: "fr-a1-vouloir-pouvoir-devoir", label: "veux، peux، dois", codes: ["vouloir", "pouvoir", "devoir"] },
    { unit: "fr-a1-venir", label: "viens، vient", codes: ["venir"] },
    { unit: "fr-a1-prendre", label: "prends، prend", codes: ["prendre"] },
    { unit: "fr-a1-faire", label: "fais، fait", codes: ["faire"] },
    { unit: "fr-a1-passe-compose-avoir", label: "j'ai mangé، il est arrivé", perfect: true },
    { unit: "fr-a2-pronoms-cod", label: "je le vois", codes: ["le-pron", "la-pron", "les-pron"] },
    { unit: "fr-a2-pronoms-coi", label: "je lui parle", match: (tokens, index, context) => (lower(tokens[index]) === "lui" || tokens[index].code === "leur") && isVerb(tokens[index + 1], context) },
    {
      unit: "fr-a2-y",
      label: "j'y vais",
      // Not «il y a» (and «il n'y a pas», «il y avait»): that is A1.
      match: (tokens, index) => tokens[index].code === "y" && !tokens.slice(Math.max(0, index - 2), index).some((token) => lower(token) === "il"),
    },
    { unit: "fr-a2-en", label: "j'en veux", codes: ["en-pron"] },
    { unit: "fr-a2-imparfait-formes", label: "j'étais، il faisait", tense: "imparfait" },
    { unit: "fr-a2-ne-plus-jamais", label: "ne … plus، ne … jamais", match: (tokens, index) => /^(plus|jamais)$/u.test(lower(tokens[index])) && negatedBefore(tokens, index) },
    {
      unit: "fr-a2-ne-rien-personne",
      label: "ne … rien، ne … personne",
      match: (tokens, index) => /^(rien|personne)$/u.test(lower(tokens[index])) && (negatedBefore(tokens, index) || /^(ne|n')$/u.test(lower(tokens[index + 1]))),
    },
    { unit: "fr-a2-passe-compose-pronominaux", label: "je me suis levé", pairs: [["me", "m'", "te", "t'", "se", "s'"], FR_ETRE_PRESENT] },
    { unit: "fr-a2-relatif-qui", label: "l'homme qui parle", match: (tokens, index, context) => lower(tokens[index]) === "qui" && ["noun", "pron"].includes(posOf(tokens[index - 1], context) ?? "") },
    { unit: "fr-a2-relatif-que", label: "le livre que je lis", match: (tokens, index, context) => /^(que|qu')$/u.test(lower(tokens[index])) && posOf(tokens[index - 1], context) === "noun" },
    { unit: "fr-a2-relatif-ou", label: "la ville où j'habite", match: (tokens, index, context) => lower(tokens[index]) === "où" && posOf(tokens[index - 1], context) === "noun" },
    { unit: "fr-a2-superlatif", label: "le plus grand", pairs: [["le", "la", "les"], ["plus", "moins"]] },
    { unit: "fr-a2-meilleur-mieux", label: "meilleur، mieux", codes: ["meilleur", "mieux"] },
    { unit: "fr-a2-futur-simple", label: "je ferai، il sera", tense: "futur simple" },
    { unit: "fr-a2-si-present", label: "si tu veux، s'il fait beau", match: (tokens, index) => (lower(tokens[index]) === "si" && FR_SUBJECTS.has(lower(tokens[index + 1]))) || (lower(tokens[index]) === "s'" && /^ils?$/u.test(lower(tokens[index + 1]))) },
    { unit: "fr-a2-indefinis", label: "plusieurs، quelque part", codes: ["plusieurs", "quelque part"] },
    { unit: "fr-a2-celui-celle", label: "celui، celle", codes: ["celui", "celle", "ceux", "celles"] },
    // «je voudrais» is a chunk from the first dialogues on; the other polite forms wait for their unit.
    { unit: "fr-a2-conditionnel-politesse", label: "pourriez-vous، ce serait", forms: ["pourrais", "pourrait", "pourriez", "pourrions", "pourraient", "serait", "serais", "seraient", "faudrait", "aimerais", "aimerait", "aimeriez", "aimerions"] },
    { unit: "fr-a2-cause-consequence", label: "car، donc", codes: ["car", "donc"] },
    {
      unit: "fr-a2-temps",
      label: "avant de، pendant que",
      match: (tokens, index) => (lower(tokens[index]) === "avant" && /^(de|d')$/u.test(lower(tokens[index + 1]))) || (lower(tokens[index]) === "pendant" && /^(que|qu')$/u.test(lower(tokens[index + 1]))),
    },
  ],
};

const FR_PERFECT_GAP = new Set(["ne", "n'", "pas", "déjà", "jamais", "bien", "beaucoup", "encore", "tout", "rien", "plus"]);
const FR_PARTICIPLE = /(é|ée|és|ées|i|ie|is|it|u|ue|us|ert|erte|eint|ort|enu|enue|enus)$/u;
const FR_AUX = new Set(["avoir", "être"]);

/** The comparative needs «que» two or three words after plus, moins or aussi. */
function comparative(tokens: TimingToken[], index: number): boolean {
  const next = tokens.slice(index + 2, index + 4).map((token) => token.surface.toLowerCase());
  return next.some((surface) => surface === "que" || surface === "qu'");
}

/** Whether the sentence's tokens outside the gap carry this grammar point. */
export function carries(marker: Marker, tokens: TimingToken[], context: TimingContext): boolean {
  const { verbs } = context;
  return tokens.some((token, index) => {
    if (token.inGap) return false;
    const surface = token.surface.toLowerCase();
    if (marker.codes && token.code && marker.codes.includes(token.code)) return true;
    if (marker.forms?.includes(surface)) return true;
    if (marker.match) return marker.match(tokens, index, context);
    if (marker.tense) {
      // A separable verb's token is «kaufte ... ein»: its verb is the first piece.
      const verb = surface.split(" ")[0];
      return isVerb(token, context) && !!context.tenseForms.get(marker.tense)?.has(verb) && !marker.except?.includes(verb);
    }
    if (marker.pairs) {
      const [first, second] = marker.pairs;
      if (!first.includes(surface)) return false;
      if (second.length === 0) return comparative(tokens, index);
      const next = tokens[index + 1];
      return !!next && !next.inGap && second.includes(next.surface.toLowerCase());
    }
    if (marker.perfect && token.code && FR_AUX.has(token.code)) {
      let at = index + 1;
      while (tokens[at] && FR_PERFECT_GAP.has(tokens[at].surface.toLowerCase())) at++;
      const next = tokens[at];
      return !!next && !next.inGap && !!next.code && verbs.has(next.code) && FR_PARTICIPLE.test(next.surface.toLowerCase());
    }
    return false;
  });
}

/**
 * A tense's forms for the `tense` marks, from the pack's conjugation tables: only the verb word of each form
 * («levais» of «me levais», «habillais» of «m'habillais», «kaufte» of «kaufte ein»), and never a form that the
 * same verbs also have in another tense of the tables (so a present form is never taken for an imparfait).
 */
export function tenseForms(language: LanguageCode, tables: { tense: string; forms: Record<string, string> }[]): Map<string, Set<string>> {
  const verbWord = (form: string) => {
    const pieces = form.toLowerCase().split(" ");
    const word = language === "de" ? pieces[0] : pieces[pieces.length - 1];
    return word.replace(/^\p{L}'/u, "");
  };
  const byTense = new Map<string, Set<string>>();
  for (const table of tables) {
    const set = byTense.get(table.tense) ?? new Set<string>();
    for (const form of Object.values(table.forms)) set.add(verbWord(form));
    byTense.set(table.tense, set);
  }
  const out = new Map<string, Set<string>>();
  for (const [tense, forms] of byTense) {
    const elsewhere = new Set([...byTense].filter(([other]) => other !== tense).flatMap(([, set]) => [...set]));
    out.set(tense, new Set([...forms].filter((form) => !elsewhere.has(form))));
  }
  return out;
}

/**
 * The sentences that use a grammar point before its unit. `cardOrder` is every card word of the language in
 * teaching order (levels in order, then the list order); `gate` is `gate.grammar_words`. `words` (every word,
 * also those without a card) gives the parts of speech the rules read, `forms` the tenses' forms.
 */
export function grammarTiming(
  language: LanguageCode,
  lines: TimingLine[],
  units: TimingUnit[],
  cardOrder: PackWord[],
  gate: number,
  extra: { words?: PackWord[]; forms?: Map<string, Set<string>> } = {},
): TimingNote[] {
  const index = new Map(cardOrder.map((word, i) => [word, i + 1]));
  const all = extra.words ?? cardOrder;
  const verbs = new Set(all.filter((word) => word.word.pos === "verb").map((word) => word.word.code));
  const context: TimingContext = { verbs, pos: new Map(all.map((word) => [word.word.code, word.word.pos])), tenseForms: extra.forms ?? new Map() };
  const unitLevel = new Map(units.map((unit) => [unit.unit_code, unit.level]));
  const arrives = new Map<string, number>();
  let before = 0;
  for (const level of [...new Set(cardOrder.map((word) => word.level))]) {
    const cards = cardOrder.filter((word) => word.level === level).length;
    const levelUnits = units.filter((unit) => unit.level === level).sort((a, b) => a.order - b.order);
    const step = levelUnits.length ? cards / levelUnits.length : 0;
    for (const [k, unit] of levelUnits.entries()) arrives.set(unit.unit_code, before + Math.max(gate, Math.round(gate + k * step)));
    before += cards;
  }
  const notes: TimingNote[] = [];
  for (const line of lines) {
    const wordIndex = index.get(line.target);
    if (!wordIndex) continue;
    for (const marker of TIMING_MARKERS[language]) {
      const when = arrives.get(marker.unit);
      if (when === undefined || wordIndex >= when) continue;
      // A1 marks look at every sentence; a later level's marks only at that level's sentences (see the top).
      const level = unitLevel.get(marker.unit);
      if (level && level !== "A1" && level !== line.target.level) continue;
      if (carries(marker, line.tokens, context)) {
        notes.push({ file: line.file, line: line.line, word: line.target.word.code, wordIndex, unit: marker.unit, arrives: when, text: `«${marker.label}» before its unit ${marker.unit} (word ${wordIndex}, unit about word ${when}): ${line.text}` });
      }
    }
  }
  return notes;
}
