import { describe, expect, it } from "vitest";
import { grammarTiming, tenseForms, type TimingLine, type TimingToken } from "@/server/content/packs/timing";
import { checkWordPack, frequencyRanks } from "@/server/content/packs/words";

/** «Grammar before its lesson» (content:check --timing): word sentences that lean on a unit the learner meets later. */
const header = "lemma\tpos\tgender\tplural\tmeaning_fa\tconcept_fa\ttopic";
const words = (language: "fr" | "de", lines: string[], level = "A1") => {
  const built = checkWordPack(language, [{ level, file: `${level}.tsv`, text: [header, ...lines].join("\n") }], frequencyRanks(language));
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

  it("reads A2 marks only in A2 sentences: a tense's forms, a relative qui, an object pronoun", () => {
    const a1 = words("fr", ["hier\tadv\t\t\tدیروز\tدیروز\ttime"]);
    const a2 = words("fr", ["homme\tnoun\tm\t\tمرد\tمرد\tpeople", "parler\tverb\t\t\tحرف زدن\tحرف زدن\tactions", "voir\tverb\t\t\tدیدن\tدیدن\tactions"], "A2");
    const [hier] = a1;
    const [homme, parler, voir] = a2;
    const cards = [...a1, ...a2];
    const units = [
      { unit_code: "fr-a2-imparfait-formes", level: "A2", order: 7 },
      { unit_code: "fr-a2-relatif-qui", level: "A2", order: 15 },
      { unit_code: "fr-a2-pronoms-cod", level: "A2", order: 1 },
    ];
    const forms = tenseForms("fr", [
      { tense: "présent", forms: { je: "parle", il_elle_on: "parle" } },
      { tense: "imparfait", forms: { je: "parlais", il_elle_on: "parlait" } },
    ]);
    const lines: TimingLine[] = [
      { file: "f", line: 1, target: hier, text: "", tokens: tokens("[Hier]=hier il=il parlait=parler") },
      { file: "f", line: 2, target: homme, text: "", tokens: tokens("Il=il parlait=parler à=à un=un [homme]=homme") },
      { file: "f", line: 3, target: voir, text: "", tokens: tokens("L'=le homme=homme qui=qui parle=parler [voit]=voir") },
      { file: "f", line: 4, target: homme, text: "", tokens: tokens("Je=je le=le-pron vois=voir [homme]=homme") },
      { file: "f", line: 5, target: parler, text: "", tokens: tokens("Qui=qui [parle]=parler ?") },
    ];
    // Gate 2, one A1 card, three A2 cards and three A2 units: the pronouns arrive at word 3, imparfait at 4, qui at 5.
    const notes = grammarTiming("fr", lines, units, cards, 2, { words: cards, forms });
    expect(notes.map((note) => [note.line, note.unit])).toEqual([
      [2, "fr-a2-imparfait-formes"],
      [3, "fr-a2-relatif-qui"],
      [4, "fr-a2-pronoms-cod"],
    ]);
  });

  it("counts an adjective without an article, but not viele, wenig or nächste Woche", () => {
    const a1 = words("de", ["viel\tadj\t\t\tزیاد\tزیاد\tqualities", "Leute\tnoun\tdie\t\tمردم\tمردم\tpeople\tnumber:pl_only", "Woche\tnoun\tdie\tWochen\tهفته\tهفته\ttime", "Kaffee\tnoun\tder\t\tقهوه\tقهوه\tdrink\tnumber:sg_only"]);
    // kommen is the first A2 card, before the unit arrives.
    const a2 = words("de", ["kommen\tverb\t\t\tآمدن\tآمدن\tactions", "nächste\tadj\t\t\tبعدی\tبعدی\ttime", "frisch\tadj\t\t\tتازه\tتازه\tqualities"], "A2");
    const [kommen] = a2;
    const cards = [...a1, ...a2];
    const units = [{ unit_code: "de-a2-adjektiv-ohne-artikel", level: "A2", order: 24 }];
    const lines: TimingLine[] = [
      { file: "f", line: 1, target: kommen, text: "", tokens: tokens("Viele=viel Leute=Leute [kommen]=kommen") },
      { file: "f", line: 2, target: kommen, text: "", tokens: tokens("Nächste=nächste Woche=Woche [kommen]=kommen wir=wir") },
      { file: "f", line: 3, target: kommen, text: "", tokens: tokens("Frischer=frisch Kaffee=Kaffee [kommt]=kommen") },
    ];
    const notes = grammarTiming("de", lines, units, cards, 2, { words: cards, forms: tenseForms("de", []) });
    expect(notes.map((note) => note.line)).toEqual([3]);
  });

  it("lets «ich hätte gern» pass as an A1 chunk, but not würde or hätten without gern", () => {
    const a2 = words("de", ["kommen\tverb\t\t\tآمدن\tآمدن\tactions", "Kaffee\tnoun\tder\t\tقهوه\tقهوه\tdrink\tnumber:sg_only"], "A2");
    const [kommen] = a2;
    const units = [{ unit_code: "de-a2-hoeflich", level: "A2", order: 26 }];
    const lines: TimingLine[] = [
      { file: "f", line: 1, target: kommen, text: "", tokens: tokens("Ich=ich hätte=haben gern=gern einen=ein Kaffee=Kaffee und=und [komme]=kommen") },
      { file: "f", line: 2, target: kommen, text: "", tokens: tokens("Ich=ich würde=werden gern=gern [kommen]=kommen") },
      { file: "f", line: 3, target: kommen, text: "", tokens: tokens("Ich=ich hätte=haben Zeit=Zeit [gekommen]=kommen") },
    ];
    const notes = grammarTiming("de", lines, units, a2, 2, { words: a2, forms: tenseForms("de", []) });
    expect(notes.map((note) => note.line)).toEqual([2, 3]);
  });
});
