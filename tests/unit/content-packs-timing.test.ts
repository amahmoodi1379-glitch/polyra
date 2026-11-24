import { describe, expect, it } from "vitest";
import { grammarTiming, type TimingLine, type TimingToken } from "@/server/content/packs/timing";
import { checkWordPack, frequencyRanks } from "@/server/content/packs/words";

/** «Grammar before its lesson» (content:check --timing): word sentences that lean on a unit the learner meets later. */
const header = "lemma\tpos\tgender\tplural\tmeaning_fa\tconcept_fa\ttopic";
const words = (language: "fr" | "de", lines: string[]) => {
  const built = checkWordPack(language, [{ level: "A1", file: "A1.tsv", text: [header, ...lines].join("\n") }], frequencyRanks(language));
  expect(built.errors).toEqual([]);
  return built.words;
};
/** Tokens from «surface=code» pieces; a piece in [brackets] is the gap. */
const tokens = (text: string): TimingToken[] =>
  text.split(" ").map((piece) => {
    const inGap = piece.startsWith("[");
    const [surface, code] = piece.replace(/[[\]]/g, "").split("=");
    return { surface, code: code ?? null, inGap };
  });

describe("grammar before its unit", () => {
  const de = words("de", [
    "Tag\tnoun\tder\tTage\tروز\tروز\ttime",
    "Freund\tnoun\tder\tFreunde\tدوست\tدوست\tpeople",
    "gehen\tverb\t\t\tرفتن\tرفتن\tactions",
    "Kino\tnoun\tdas\tKinos\tسینما\tسینما\tleisure",
  ]);
  const [tag, freund, gehen, kino] = de;
  const line = (target: (typeof de)[number], text: string): TimingLine => ({ file: "A1/01.txt", line: 1, target, text, tokens: tokens(text) });
  const units = [
    { unit_code: "de-a1-war-hatte", level: "A1", order: 1 },
    { unit_code: "de-a1-dativ-praepositionen", level: "A1", order: 2 },
  ];

  it("names a sentence whose word comes before the unit, and only outside the gap", () => {
    // Gate 1, four card words, two units: war/hatte arrives at word 1, the dative at word 3.
    const notes = grammarTiming("de", [line(tag, "Wie=wie war=sein dein=dein [Tag]=Tag"), line(freund, "Ich=ich gehe=gehen zu=zu meinem=mein [Freund]=Freund"), line(kino, "Ich=ich gehe=gehen mit=mit dem=der Freund=Freund ins=ins [Kino]=Kino")], units, de, 1);
    expect(notes.map((note) => [note.word, note.unit, note.arrives])).toEqual([["Freund", "de-a1-dativ-praepositionen", 3]]);
  });

  it("does not count the gap itself", () => {
    const notes = grammarTiming("de", [line(gehen, "Ich=ich [gehe]=gehen mit=mit [dem]=der Freund=Freund")], units, de, 4);
    expect(notes).toEqual([]);
  });

  it("finds the French passé composé across ne … pas, and du as a partitive", () => {
    const fr = words("fr", ["pain\tnoun\tm\t\tنان\tنان\tfood", "hier\tadv\t\t\tدیروز\tدیروز\ttime", "manger\tverb\t\t\tخوردن\tخوردن\tfood"]);
    const [pain, hier] = fr;
    const frUnits = [
      { unit_code: "fr-a1-partitif", level: "A1", order: 1 },
      { unit_code: "fr-a1-passe-compose-avoir", level: "A1", order: 2 },
    ];
    const notes = grammarTiming(
      "fr",
      [
        { file: "f", line: 1, target: pain, text: "", tokens: tokens("Je=je mange=manger du=du [pain]=pain") },
        { file: "f", line: 2, target: hier, text: "", tokens: tokens("[Hier]=hier je=je n'=ne ai=avoir pas=pas mangé=manger") },
        { file: "f", line: 3, target: hier, text: "", tokens: tokens("[Hier]=hier je=je mange=manger") },
      ],
      frUnits,
      fr,
      5,
    );
    expect(notes.map((note) => [note.line, note.unit])).toEqual([
      [1, "fr-a1-partitif"],
      [2, "fr-a1-passe-compose-avoir"],
    ]);
  });
});
