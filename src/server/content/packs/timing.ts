/**
 * «Grammar before its lesson» (owner, 24 Nov 2026): a word's sentence should not lean on a grammar point
 * whose unit a learner meets only much later. The word lists only check words; this check looks for the
 * marks of a few grammar points (war/hatte, mir/dir, modal verbs, du pain, passé composé …) in each word
 * sentence, outside its gap, and names the sentences whose word comes before the unit that teaches it.
 *
 * When a unit comes is estimated from the engine's pace: grammar opens after `gate.grammar_words` card
 * words and then moves with vocabulary, so unit k of n at a level arrives about (k − 1) × (card words ÷ n)
 * words later. It is a warning for the writer, never an error: a chunk like «Wie geht es dir?» is fine early.
 */
import type { LanguageCode } from "../languages";
import type { PackWord } from "./words";

export type TimingToken = { surface: string; code: string | null; inGap: boolean };
export type TimingLine = { file: string; line: number; target: PackWord; text: string; tokens: TimingToken[] };
export type TimingUnit = { unit_code: string; level: string; order: number };
export type TimingNote = { file: string; line: number; word: string; wordIndex: number; unit: string; arrives: number; text: string };

/** A grammar point's marks: word codes (any form), surfaces, or two surfaces side by side. */
type Marker = {
  unit: string;
  label: string;
  codes?: string[];
  forms?: string[];
  pairs?: [string[], string[]];
  /** French passé composé: a form of avoir or être, then (after ne/pas/déjà …) a participle-shaped verb. */
  perfect?: boolean;
};

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
  ],
  fr: [
    { unit: "fr-a1-comparatif", label: "plus … que", pairs: [["plus", "moins", "aussi"], []] },
    { unit: "fr-a1-partitif", label: "du pain", codes: ["du"] },
    { unit: "fr-a1-vouloir-pouvoir-devoir", label: "veux، peux، dois", codes: ["vouloir", "pouvoir", "devoir"] },
    { unit: "fr-a1-venir", label: "viens، vient", codes: ["venir"] },
    { unit: "fr-a1-prendre", label: "prends، prend", codes: ["prendre"] },
    { unit: "fr-a1-faire", label: "fais، fait", codes: ["faire"] },
    { unit: "fr-a1-passe-compose-avoir", label: "j'ai mangé، il est arrivé", perfect: true },
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
export function carries(marker: Marker, tokens: TimingToken[], verbs: Set<string>): boolean {
  return tokens.some((token, index) => {
    if (token.inGap) return false;
    const surface = token.surface.toLowerCase();
    if (marker.codes && token.code && marker.codes.includes(token.code)) return true;
    if (marker.forms?.includes(surface)) return true;
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
 * The sentences that use a grammar point before its unit. `cardOrder` is every card word of the language in
 * teaching order (levels in order, then the list order); `gate` is `gate.grammar_words`.
 */
export function grammarTiming(language: LanguageCode, lines: TimingLine[], units: TimingUnit[], cardOrder: PackWord[], gate: number): TimingNote[] {
  const index = new Map(cardOrder.map((word, i) => [word, i + 1]));
  const verbs = new Set(cardOrder.filter((word) => word.word.pos === "verb").map((word) => word.word.code));
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
      if (carries(marker, line.tokens, verbs)) {
        notes.push({ file: line.file, line: line.line, word: line.target.word.code, wordIndex, unit: marker.unit, arrives: when, text: `«${marker.label}» before its unit ${marker.unit} (word ${wordIndex}, unit about word ${when}): ${line.text}` });
      }
    }
  }
  return notes;
}
