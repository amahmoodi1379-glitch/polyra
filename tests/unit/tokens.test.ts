import { describe, expect, it } from "vitest";
import { checkTokens, splitPieces, type TokenInput, type VocabEntry, type Vocabulary } from "@/engine/tokens";

function vocab(entries: Record<string, Partial<VocabEntry> & { lemma: string }>, exceptions: string[] = []): Vocabulary {
  const list = Object.entries(entries).map(([code, entry], index) => ({
    code,
    id: index + 1,
    plural: null,
    pos: "noun",
    forms: [],
    partLemmas: [],
    ...entry,
  }));
  return {
    byCode: (code) => list.find((entry) => entry.code === code),
    hasLemmaOrPlural: (text) =>
      list.some((entry) => entry.lemma.toLowerCase() === text.toLowerCase() || entry.plural?.toLowerCase() === text.toLowerCase()),
    isException: (wordId, surface) => exceptions.includes(`${wordId}:${surface}`),
  };
}

const w = (surface: string, code: string | null, kind: TokenInput["kind"] = "word"): TokenInput => ({
  surface,
  kind,
  code,
  meaning_fa: kind === "name" ? null : "معنی",
});

const fr = vocab({
  je: { lemma: "je", pos: "pron" },
  vouloir: { lemma: "vouloir", pos: "verb", forms: ["veux", "veut", "voulons"] },
  manger: { lemma: "manger", pos: "verb" },
  un: { lemma: "un", pos: "det" },
  pomme: { lemma: "pomme" },
  habiter: { lemma: "habiter", pos: "verb" },
  à: { lemma: "à", pos: "prep" },
  depuis: { lemma: "depuis", pos: "prep" },
  an: { lemma: "an" },
  avoir: { lemma: "avoir", pos: "verb" },
  "s'il vous plaît": { lemma: "s'il vous plaît", pos: "phrase" },
  être: { lemma: "être", pos: "verb" },
  œil: { lemma: "œil", plural: "yeux" },
  "prendre une décision": { lemma: "prendre une décision", pos: "phrase", partLemmas: ["prendre", "décision"] },
});

describe("splitPieces (PRD §14.1 rule 1)", () => {
  it("splits on apostrophes and hyphens and keeps numbers with signs together", () => {
    expect(splitPieces("J'ai mangé à 14h30, a-t-il dit. 2,50 €").map((piece) => piece.text)).toEqual([
      "J", "ai", "mangé", "à", "14h30", "a", "t", "il", "dit", "2,50",
    ]);
  });
});

describe("checkTokens", () => {
  it("maps a clean sentence; conjugated forms are accepted through the table", () => {
    const result = checkTokens(
      "Je veux manger une pomme.",
      [w("Je", "je"), w("veux", "vouloir"), w("manger", "manger"), w("une", "un"), w("pomme", "pomme")],
      fr,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.every((row) => !row.suspect && row.candidate_reason === null)).toBe(true);
    expect(result.rows[1].spans).toEqual([[3, 7]]);
  });

  it("accepts names and digit numbers without codes", () => {
    const result = checkTokens(
      "Marie habite à Paris depuis 3 ans.",
      [w("Marie", null, "name"), w("habite", "habiter"), w("à", "à"), w("Paris", null, "name"), w("depuis", "depuis"), w("3", null, "number"), w("ans", "an")],
      fr,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a sentence when a word is missing from tokens", () => {
    const result = checkTokens("Je veux manger une pomme.", [w("Je", "je"), w("veux", "vouloir"), w("une", "un"), w("pomme", "pomme")], fr);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    // The exact missing word is named, not a chain of follow-on errors.
    expect(result.problems).toEqual([{ type: "uncovered", piece: "manger" }]);
  });

  it("rejects tokens given out of sentence order", () => {
    const result = checkTokens("Je veux manger.", [w("Je", "je"), w("manger", "manger"), w("veux", "vouloir")], fr);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.problems).toEqual([
      { type: "not_found", position: 2, surface: "veux" },
      { type: "uncovered", piece: "veux" },
    ]);
  });

  it("rejects a name without a capital letter and a number without digits", () => {
    const result = checkTokens("Marie a 3 ans.", [w("Marie", null, "name"), w("a", "avoir"), w("3", null, "number"), w("ans", "an")], fr);
    expect(result.ok).toBe(true);
    const bad = checkTokens("marie a trois ans.", [w("marie", null, "name"), w("a", "avoir"), w("trois", null, "number"), w("ans", "an")], fr);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.problems.map((problem) => problem.type)).toEqual(["name_not_capital", "number_without_digit"]);
  });

  it("covers several pieces with one surface (contractions, phrases)", () => {
    const result = checkTokens("J'ai faim, s'il vous plaît.", [w("J'", "je"), w("ai", "avoir"), w("faim", "faim"), w("s'il vous plaît", "s'il vous plaît")], fr);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[2].candidate_reason).toBe("missing");
    expect(result.rows[3].spans).toEqual([[11, 26]]);
  });

  it("marks implausible mappings as suspect unless confirmed in form_exception", () => {
    const tokens = [w("Je", "je"), w("suis", "être"), w("là", null)];
    const result = checkTokens("Je suis là.", tokens, fr);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1].suspect).toBe(true);
    const confirmed = checkTokens("Je suis là.", tokens, vocab({ je: { lemma: "je" }, être: { lemma: "être" } }, ["2:suis"]));
    expect(confirmed.ok && confirmed.rows[1].suspect).toBe(false);
  });

  it("accepts a plural and a short form that matches the start of the lemma", () => {
    const result = checkTokens("J'ai les yeux.", [w("J'", "je"), w("ai", "avoir"), w("les", null), w("yeux", "œil")], fr);
    expect(result.ok && result.rows[3].suspect).toBe(false);
  });

  it("handles a German separable verb split across the sentence", () => {
    const de = vocab({ ich: { lemma: "ich", pos: "pron" }, aufstehen: { lemma: "aufstehen", pos: "verb" }, um: { lemma: "um" }, sieben: { lemma: "sieben" } });
    const result = checkTokens("Ich stehe um sieben auf.", [w("Ich", "ich"), w("stehe ... auf", "aufstehen"), w("um", "um"), w("sieben", "sieben")], de);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1].spans).toEqual([[4, 9], [20, 23]]);
    expect(result.rows[1].suspect).toBe(false);
  });

  it("checks a phrase by its parts", () => {
    const result = checkTokens("Il prend une décision.", [w("Il", null), w("prend une décision", "prendre une décision")], fr);
    expect(result.ok && result.rows[1].suspect).toBe(false);
  });

  it("flags a name that is really a vocabulary word (German nouns are capitalised)", () => {
    const de = vocab({ Tisch: { lemma: "Tisch", plural: "Tische" }, der: { lemma: "der", pos: "det" } });
    const result = checkTokens("Der Tisch", [w("Der", "der"), w("Tisch", null, "name")], de);
    expect(result.ok && result.rows[1].candidate_reason).toBe("name_matches_word");
  });
});
