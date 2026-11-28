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

  it("reads the B1 marks in B1 sentences only, and lets je voudrais and «nous les avons» pass", () => {
    const verbs = words("fr", ["avoir\tverb\t\t\tداشتن\tداشتن\tactions", "faire\tverb\t\t\tانجام دادن\tانجام دادن\tactions", "vouloir\tverb\t\t\tخواستن\tخواستن\tactions", "parler\tverb\t\t\tحرف زدن\tحرف زدن\tactions", "donner\tverb\t\t\tدادن\tدادن\tactions", "mettre\tverb\t\t\tگذاشتن\tگذاشتن\tactions", "réparer\tverb\t\t\tتعمیر کردن\tتعمیر کردن\tactions", "compter\tverb\t\t\tمهم بودن\tمهم بودن\tactions"]);
    const [cuisine] = words("fr", ["cuisine\tnoun\tf\t\tآشپزخانه\tآشپزخانه\thome"], "A2");
    const [valise] = words("fr", ["valise\tnoun\tf\t\tچمدان\tچمدان\ttravel"], "B1");
    const cards = [cuisine, valise];
    const units = ["plus-que-parfait", "conditionnel", "ne-que", "relatif-dont", "subjonctif", "ce-qui-ce-que", "subjonctif-conjonctions", "gerondif", "doubles-pronoms", "faire-infinitif"].map((name, k) => ({ unit_code: `fr-b1-${name}`, level: "B1", order: k + 1 }));
    const forms = tenseForms("fr", [
      { tense: "conditionnel présent", forms: { je: "ferais", tu: "voudrais" } },
      { tense: "subjonctif présent", forms: { je: "que je fasse" } },
    ]);
    const b1 = (line: number, text: string): TimingLine => ({ file: "f", line, target: valise, text: "", tokens: tokens(text) });
    const lines: TimingLine[] = [
      b1(1, "Il=il avait=avoir déjà=déjà fait=faire sa=son [valise]=valise"),
      b1(2, "Je=je voudrais=vouloir une=un [valise]=valise"),
      b1(3, "Je=je ferais=faire ma=mon [valise]=valise"),
      b1(4, "Je=je n'=ne ai=avoir qu'=que une=un [valise]=valise"),
      b1(5, "La=le [valise]=valise dont=dont je=je parle=parler"),
      b1(6, "Il=il faut=falloir que=que je=je fasse=faire ma=mon [valise]=valise"),
      b1(7, "Ce=ce qui=qui compte=compter c'=ce est=être ma=mon [valise]=valise"),
      b1(8, "Il=il parle=parler en=en faisant=faire sa=son [valise]=valise"),
      b1(9, "Je=je te=te la=le donne=donner ta=ton [valise]=valise"),
      b1(10, "Nous=nous les=le avons=avoir mis=mettre dans=dans la=le [valise]=valise"),
      b1(11, "Je=je fais=faire réparer=réparer ma=mon [valise]=valise"),
      b1(13, "Je=je pense=penser à=à ce=ce que=que tu=tu as=avoir dit=dire de=de ma=mon [valise]=valise"),
      b1(14, "J'=je attends=attendre jusqu'à=jusqu'à ce=ce que=que tu=tu fermes=fermer ta=ton [valise]=valise"),
      { file: "f", line: 12, target: cuisine, text: "", tokens: tokens("Il=il avait=avoir fait=faire la=le [cuisine]=cuisine") },
    ];
    // Gate 5: every unit arrives after word 6, so each B1 mark in a sentence of word 2 is early; word 1 is A2.
    const notes = grammarTiming("fr", lines, units, cards, 5, { words: [...verbs, ...cards], forms });
    expect(notes.map((note) => [note.line, note.unit])).toEqual([
      [1, "fr-b1-plus-que-parfait"],
      [3, "fr-b1-conditionnel"],
      [4, "fr-b1-ne-que"],
      [5, "fr-b1-relatif-dont"],
      [6, "fr-b1-subjonctif"],
      [7, "fr-b1-ce-qui-ce-que"],
      [8, "fr-b1-gerondif"],
      [9, "fr-b1-doubles-pronoms"],
      [11, "fr-b1-faire-infinitif"],
      [13, "fr-b1-ce-qui-ce-que"],
      [14, "fr-b1-subjonctif-conjonctions"],
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

  it("reads im, am, zum as articles and lets greetings like «Liebe Grüße» pass as chunks", () => {
    const a1 = words("de", ["lieb\tadj\t\t\tعزیز\tعزیز\tfeelings", "Gruß\tnoun\tder\tGrüße\tسلام\tسلام\tpeople", "Stock\tnoun\tder\tStöcke\tطبقه\tطبقه\thome", "erste\tadj\t\t\tاول\tاول\tnumbers", "Kaffee\tnoun\tder\t\tقهوه\tقهوه\tdrink\tnumber:sg_only"]);
    const a2 = words("de", ["kommen\tverb\t\t\tآمدن\tآمدن\tactions", "frisch\tadj\t\t\tتازه\tتازه\tqualities"], "A2");
    const [kommen] = a2;
    const cards = [...a1, ...a2];
    const units = [{ unit_code: "de-a2-adjektiv-ohne-artikel", level: "A2", order: 24 }];
    const lines: TimingLine[] = [
      { file: "f", line: 1, target: kommen, text: "", tokens: tokens("Liebe=lieb Grüße=Gruß und=und [komm]=kommen bald=bald") },
      { file: "f", line: 2, target: kommen, text: "", tokens: tokens("Sie=Sie [kommen]=kommen im=im ersten=erste Stock=Stock an=an") },
      { file: "f", line: 3, target: kommen, text: "", tokens: tokens("Frischer=frisch Kaffee=Kaffee [kommt]=kommen") },
    ];
    const notes = grammarTiming("de", lines, units, cards, 2, { words: cards, forms: tenseForms("de", []) });
    expect(notes.map((note) => note.line)).toEqual([3]);
  });

  it("does not take a German participle of a compound tense for a Präteritum (habe verloren)", () => {
    const forms = tenseForms("de", [
      { tense: "Präteritum", forms: { ich: "verlor", wir: "verloren", er: "kaufte" } },
      { tense: "Perfekt", forms: { ich: "habe verloren" } },
    ]);
    expect([...forms.get("Präteritum")!]).toEqual(["verlor", "kaufte"]);
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
