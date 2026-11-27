import { describe, expect, it } from "vitest";
import { standardTable } from "@/server/content/conjugation-check";
import { Analyzer } from "@/server/content/packs/analyze";
import { buildPack } from "@/server/content/packs/build";
import { buildDialogues } from "@/server/content/packs/dialogues";
import { buildErrorfix, splitMarked } from "@/server/content/packs/errorfix";
import { buildTexts } from "@/server/content/packs/texts";
import { buildWriting } from "@/server/content/packs/writing";
import { buildPhonics } from "@/server/content/packs/phonics";
import { buildGrammar } from "@/server/content/packs/grammar";
import { germanAdjectiveForms, Morph } from "@/server/content/packs/morph";
import { buildSentences } from "@/server/content/packs/sentences";
import { buildTables } from "@/server/content/packs/tables";
import { nearMeaning, verbDistractors } from "@/server/content/packs/distractors";
import { checkWordPack, frequencyRanks, type PackWord } from "@/server/content/packs/words";
import { appSettingDefaults } from "@/server/settings/app-catalog";

/** The content packs: sentences mapped to words, wrong options and tables made from open data (content/README.md). */
const pack = buildPack("fr", { contentRoot: "tests/fixtures/packs" });
const level = pack.levels[0];
const sentence = (text: string) => level.sentences.find((item) => item.text === text)!;
const target = (text: string, code: string) => sentence(text).targets.find((item) => item.target === code)!;

const header = "lemma\tpos\tgender\tplural\tmeaning_fa\tconcept_fa\ttopic";
const words = (language: "fr" | "de", lines: string[]) => {
  const built = checkWordPack(language, [{ level: "A1", file: "A1.tsv", text: [header, ...lines].join("\n") }], frequencyRanks(language));
  expect(built.errors).toEqual([]);
  return built.words;
};
const analyzerOf = (language: "fr" | "de", list: PackWord[]) => new Analyzer(language, list, new Morph(language, list), new Set(["Marie"]));

describe("sentences of a pack", () => {
  it("maps every form to its word, elided ones too", () => {
    expect(pack.errors).toEqual([]);
    expect(sentence("J'ai une voiture.").tokens.map((token) => `${token.surface}=${token.code}`)).toEqual(["J'=je", "ai=avoir", "une=un", "voiture=voiture"]);
    expect(sentence("Les fleurs sont jaunes.").tokens.map((token) => token.code)).toEqual(["le", "fleur", "être", "jaune"]);
  });

  it("makes wrong options of the same kind and form, never one already in the sentence", () => {
    // A feminine noun: other feminine nouns; a plural: their plurals.
    expect(target("La voiture est petite.", "voiture").distractors).toEqual(["chaise", "maison", "fleur"]);
    expect(target("Les fleurs sont jaunes.", "fleur").distractors).toEqual(["pommes", "villes", "voitures"]);
    // An adjective agrees: «petite» gets feminine forms, «jaune» (no gender) only adjectives without one.
    expect(target("La maison est petite.", "petit").distractors).toEqual(["belle", "grande", "jaune"]);
    expect(target("La voiture est jaune.", "jaune").distractors).toEqual(["rose", "rouge", "triste"]);
    // No «homme» after «le» (it would be «l'homme»), no «chat» when the sentence has it.
    expect(target("Le chat et le chien sont dans la voiture.", "chien").distractors).toEqual(["pain", "livre", "garçon"]);
    // A conjugated verb: other forms of the same verb, with the infinitive as hint.
    expect(target("Je mange une pomme.", "manger")).toMatchObject({ distractors: ["manges", "mangeons", "mangez"], hint: "(manger)" });
  });

  it("joins a sentence written for two words into one with two targets", () => {
    expect(sentence("La maison est petite.").targets.map((item) => item.target).sort()).toEqual(["maison", "petit"]);
  });

  it("confirms the forms the import would doubt, and only those", () => {
    const surfaces = level.exceptions.map((item) => `${item.code}:${item.surface}`);
    expect(surfaces).toEqual(expect.arrayContaining(["être:suis", "être:sont", "avoir:ai", "aller:vais"]));
    expect(surfaces).not.toContain("manger:mange");
  });

  it("reads Lexique's oe spelling as œ and the adjective forms it files apart (nouvel, bel)", () => {
    const list = words("fr", ["un\tdet\t\t\tیک\tun: یک\tfunction\tno_card:1", "sœur\tnoun\tf\tsœurs\tخواهر\tخواهر\tfamily", "œuf\tnoun\tm\t\tتخم‌مرغ\tتخم‌مرغ\tfood", "nouveau\tadj\t\t\tنو\tنو\tqualities", "beau\tadj\t\t\tزیبا\tزیبا\tqualities", "ordinateur\tnoun\tm\t\tکامپیوتر\tکامپیوتر\thome"]);
    const codes = (text: string) => analyzerOf("fr", list).analyze(text, { level: "A1" }).tokens.map((token) => token.code);
    expect(codes("un nouvel ordinateur")).toEqual(["un", "nouveau", "ordinateur"]);
    expect(codes("un bel ordinateur")).toEqual(["un", "beau", "ordinateur"]);
    expect(new Morph("fr", list).candidates("œufs").map((candidate) => candidate.word.word.code)).toEqual(["œuf"]);
  });

  it("refuses a word the learner meets later than the sentence's word", () => {
    const list = words("fr", ["le\tdet\t\t\tحرف تعریف\tحرف تعریف\tfunction\tno_card:1", ...Array.from({ length: 30 }, (_, i) => `mot${i}\tnoun\tm\t\tکلمه\tکلمه ${i}\tabstract`), "chat\tnoun\tm\t\tگربه\tگربه\tanimals", "chien\tnoun\tm\t\tسگ\tسگ\tanimals"]);
    const analyzer = analyzerOf("fr", list);
    const built = buildSentences(analyzer, [{ file: "s.txt", text: "# chat\nLe [chat] et le chien. | گربه و سگ. | d: a, b, c" }], "A1", new Set());
    expect(built.errors.map((item) => item.text).join()).toMatch(/«chien» .* is taught after/);
  });
});

describe("verb phrases of a pack", () => {
  const french = () =>
    words("fr", [
      "je\tpron\t\t\tمن\tje: من\tfunction\tno_card:1",
      "tu\tpron\t\t\tتو\ttu: تو\tfunction\tno_card:1",
      "ne\tadv\t\t\tنشانهٔ منفی\tne: نشانهٔ منفی\tfunction\tno_card:1",
      "pas\tadv\t\t\tنشانهٔ منفی\tpas: نشانهٔ منفی\tfunction\tno_card:1",
      "de\tprep\t\t\tاز\tde: حرف اضافه\tfunction\tno_card:1",
      "être\tverb\t\t\tبودن\tبودن\tfunction",
      "avoir\tverb\t\t\tداشتن\tداشتن\tfunction",
      "très\tadv\t\t\tخیلی\tخیلی\tqualities",
      "d'accord\tadv\t\t\tباشه\tباشه\tabstract",
      "eau\tnoun\tf\teaux\tآب\tآب\tdrink",
      "besoin\tnoun\tm\t\tنیاز\tنیاز\tabstract",
      "faim\tnoun\tf\t\tگرسنگی\tگرسنگی\tfood\tnumber:sg_only",
      "avoir faim\tphrase\t\t\tگرسنه بودن\tگرسنه بودن\tfood\tparts:avoir faim",
      "être d'accord\tphrase\t\t\tموافق بودن\tموافق بودن\tabstract\tparts:être d'accord",
      "avoir besoin de\tphrase\t\t\tنیاز داشتن\tنیاز داشتن\tabstract\tparts:avoir besoin",
    ]);
  const german = () =>
    words("de", [
      "ich\tpron\t\t\tمن\tمن\tfunction\tno_card:1",
      "du\tpron\t\t\tتو\tتو\tfunction\tno_card:1",
      "haben\tverb\t\t\tداشتن\tداشتن\tfunction",
      "morgen\tadv\t\t\tفردا\tفردا\ttime",
      "Zeit\tnoun\tdie\tZeiten\tوقت\tوقت\ttime",
      "Hunger\tnoun\tder\t\tگرسنگی\tگرسنگی\tfood\tnumber:sg_only",
      "Zeit haben\tphrase\t\t\tوقت داشتن\tوقت داشتن\ttime\tparts:Zeit haben",
      "Hunger haben\tphrase\t\t\tگرسنه بودن\tگرسنه بودن\tfood\tparts:Hunger haben",
    ]);
  const built = (language: "fr" | "de", list: PackWord[], text: string) => buildSentences(analyzerOf(language, list), [{ file: "s.txt", text }], "A1", new Set(list));

  it("takes a phrase whose verb is conjugated, with the other persons as wrong options", () => {
    const out = built("fr", french(), ["# être d'accord", "Je [suis d'accord]. | موافقم.", "# avoir besoin de", "J'[ai besoin d']eau. | به آب نیاز دارم.", "# avoir faim", "Tu [as faim] ? | گرسنه‌ای؟"].join("\n"));
    expect(out.errors).toEqual([]);
    const [accord, besoin, faim] = out.records;
    expect(accord.tokens.map((token) => `${token.surface}=${token.code}`)).toEqual(["Je=je", "suis d'accord=être d'accord"]);
    expect(accord.targets[0]).toMatchObject({ distractors: ["es d'accord", "est d'accord", "sommes d'accord"], hint: "(être d'accord)" });
    expect(besoin.tokens.map((token) => token.code)).toEqual(["je", "avoir besoin de", "eau"]);
    expect(faim.targets[0].distractors).toEqual(["ai faim", "a faim", "avons faim"]);
  });

  it("joins a phrase split by other words of its clause, never inside a gap", () => {
    const analyzer = analyzerOf("fr", french());
    const codes = (text: string) => analyzer.analyze(text, { level: "A1" }).tokens.map((token) => `${token.surface}=${token.code}`);
    expect(codes("Je n'ai pas faim.")).toEqual(["Je=je", "n'=ne", "ai ... faim=avoir faim", "pas=pas"]);
    expect(codes("J'ai très faim.")).toEqual(["J'=je", "ai ... faim=avoir faim", "très=très"]);
    // A gap on one of its words keeps the words apart.
    expect(codes("J'ai très [faim].")).toEqual(["J'=je", "ai=avoir", "très=très", "faim=faim"]);
  });

  it("reads a German phrase with its verb first, joined or split", () => {
    const list = german();
    const out = built("de", list, "# Hunger haben\nIch [habe Hunger]. | گرسنه‌ام.");
    expect(out.errors).toEqual([]);
    expect(out.records[0].targets[0]).toMatchObject({ distractors: ["hast Hunger", "hat Hunger", "haben Hunger"], hint: "(Hunger haben)" });
    const tokens = analyzerOf("de", list).analyze("Hast du morgen Zeit?", { level: "A1" }).tokens;
    expect(tokens.map((token) => `${token.surface}=${token.code}`)).toEqual(["Hast ... Zeit=Zeit haben", "du=du", "morgen=morgen"]);
  });

  it("reads a name of names.txt as the name, not as a word form that looks like it", () => {
    const list = words("de", ["wie\tadv\t\t\tچطور\tچطور\tfunction", "Wein\tnoun\tder\tWeine\tشراب\tشراب\tfood"]);
    const analyzer = new Analyzer("de", list, new Morph("de", list), new Set(["Wien", "Wein"]));
    const read = (text: string) => analyzer.analyze(text, { level: "A1" }).tokens.map((token) => `${token.surface}=${token.code ?? token.kind}`);
    expect(new Morph("de", list).candidates("Wien").map((candidate) => candidate.word.word.code)).toContain("wie");
    expect(read("Wien wie")).toEqual(["Wien=name", "wie=wie"]);
    // A word written exactly as the name stays the word.
    expect(read("Wein")).toEqual(["Wein=Wein"]);
  });

  it("reads a German name with the genitive s as the name (Annas Auto)", () => {
    const list = words("de", ["Auto\tnoun\tdas\tAutos\tماشین\tماشین\ttransport", "sein\tverb\t\t\tبودن\tبودن\tactions", "das\tdet\t\t\tحرف تعریف\tحرف تعریف\tfunction", "neu\tadj\t\t\tنو\tنو\tqualities"]);
    const analyzer = new Analyzer("de", list, new Morph("de", list), new Set(["Anna"]));
    const analysis = analyzer.analyze("Annas Auto ist neu.", { level: "A1" });
    expect(analysis.errors).toEqual([]);
    expect(analysis.tokens[0]).toMatchObject({ surface: "Annas", kind: "name" });
  });

  it("reads «euch» as the pronoun «ihr», never as the possessive", () => {
    const list = words("de", ["ihr\tpron\t\t\tشما\tihr: شما\tfunction\tno_card:1", "ihr\tdet\t\t\tمالِ او\tihr: مال او\tfunction\tno_card:1\tcode:ihr-det"]);
    expect(new Morph("de", list).candidates("euch").map((candidate) => candidate.word.word.code)).toEqual(["ihr"]);
  });

  it("takes a noun of several words in its plural", () => {
    const list = words("fr", ["le\tdet\t\t\tحرف تعریف\tle: حرف تعریف\tfunction\tno_card:1", "pomme de terre\tnoun\tf\tpommes de terre\tسیب‌زمینی\tسیب‌زمینی\tfood", "tomate\tnoun\tf\ttomates\tگوجه\tگوجه\tfood"]);
    const tokens = analyzerOf("fr", list).analyze("Les [pommes de terre].", { level: "A1" }).tokens;
    expect(tokens.map((token) => `${token.surface}=${token.code}`)).toEqual(["Les=le", "pommes de terre=pomme de terre"]);
  });

  it("reads a form that is finite and a participle as finite unless an auxiliary comes before", () => {
    expect(verbDistractors("fr", "faire", "fait")).toEqual(["fais", "faisons", "faites"]);
    expect(verbDistractors("fr", "faire", "fait", undefined, true)).toEqual(["faire", "faisait", "font"]);
  });
});

describe("reading a form in its context", () => {
  const T = "\t";
  const line = (...cells: string[]) => cells.join(T);
  const french = words("fr", [
    line("je", "pron", "", "", "من", "je: من", "function", "no_card:1"),
    line("il", "pron", "", "", "او", "il: او", "function", "no_card:1"),
    line("te", "pron", "", "", "تو را", "te: ضمیر", "function", "no_card:1"),
    line("vous", "pron", "", "", "شما", "vous: شما", "function", "no_card:1"),
    line("se", "pron", "", "", "خود", "se: ضمیر", "function", "no_card:1"),
    line("ne", "adv", "", "", "نشانهٔ منفی", "ne: منفی", "function", "no_card:1"),
    line("pas", "adv", "", "", "نشانهٔ منفی", "pas: منفی", "function", "no_card:1"),
    line("de", "prep", "", "", "از", "de: حرف اضافه", "function", "no_card:1"),
    line("en", "prep", "", "", "در", "en: حرف اضافه", "function", "no_card:1"),
    line("ce", "det", "", "", "این", "ce: صفت اشاره", "function", "no_card:1"),
    line("ce", "pron", "", "", "این", "ce: ضمیر", "function", "no_card:1", "code:ce-pron"),
    line("la", "det", "", "", "حرف تعریف", "la: حرف تعریف", "function", "no_card:1"),
    line("la", "pron", "", "", "او را", "la: ضمیر", "function", "no_card:1", "code:la-pron"),
    line("quel", "det", "", "", "کدام", "کدام", "function"),
    line("être", "verb", "", "", "بودن", "بودن", "function"),
    line("avoir", "verb", "", "", "داشتن", "داشتن", "function"),
    line("est", "noun", "m", "", "شرق", "شرق", "space", "code:est-noun"),
    line("nom", "noun", "m", "noms", "اسم", "اسم", "people"),
    line("suivre", "verb", "", "", "دنبال کردن", "دنبال کردن", "actions"),
    line("content", "adj", "", "", "راضی", "راضی", "feelings"),
    line("porte", "noun", "f", "portes", "در", "در ورودی", "home"),
    line("porter", "verb", "", "", "بردن", "بردن", "actions"),
    line("fermer", "verb", "", "", "بستن", "بستن", "actions"),
    line("fermé", "adj", "", "", "بسته", "بسته", "qualities"),
    line("boire", "verb", "", "", "نوشیدن", "نوشیدن", "drink"),
    line("bois", "noun", "m", "", "چوب", "چوب", "nature"),
    line("eau", "noun", "f", "eaux", "آب", "آب", "drink"),
    line("été", "noun", "m", "étés", "تابستان", "تابستان", "time"),
    line("vivre", "verb", "", "", "زندگی کردن", "زندگی کردن", "actions"),
    line("voir", "verb", "", "", "دیدن", "دیدن", "actions"),
    line("plus", "adv", "", "", "بیشتر", "بیشتر", "qualities"),
    line("plus", "adv", "", "", "دیگر نه", "دیگر نه", "time", "code:plus-2", "sense_of:plus"),
    line("grand", "adj", "", "", "بزرگ", "بزرگ", "qualities"),
    line("si", "conj", "", "", "اگر", "اگر", "function"),
    line("pleuvoir", "verb", "", "", "باران آمدن", "باران آمدن", "weather"),
    line("quand", "adv", "", "", "کی", "چه وقت", "function"),
    line("quand", "conj", "", "", "وقتی که", "وقتی که", "time", "code:quand-conj"),
    line("partir", "verb", "", "", "رفتن", "رفتن", "actions"),
    line("vouloir", "verb", "", "", "خواستن", "خواستن", "actions"),
    line("je voudrais", "phrase", "", "", "می‌خواستم", "خواستن مؤدبانه", "shopping", "parts:vouloir"),
    line("venir", "verb", "", "", "آمدن", "آمدن", "actions"),
    line("venir de", "phrase", "", "", "تازه ... کردن", "گذشته نزدیک", "time", "parts:venir"),
    line("manger", "verb", "", "", "خوردن", "خوردن", "food"),
    line("mal", "adv", "", "", "بد", "بد", "qualities"),
    line("avoir mal", "phrase", "", "", "درد داشتن", "درد داشتن", "health", "parts:avoir mal"),
    line("dormir", "verb", "", "", "خوابیدن", "خوابیدن", "actions"),
    line("appeler", "verb", "", "", "زنگ زدن", "زنگ زدن", "media"),
    line("s'appeler", "verb", "", "", "اسم داشتن", "اسم داشتن", "people"),
    line("demain", "adv", "", "", "فردا", "فردا", "time"),
    line("trouver", "verb", "", "", "پیدا کردن", "پیدا کردن", "actions"),
    line("se trouver", "verb", "", "", "واقع بودن", "واقع بودن", "space"),
  ]);
  const fr = analyzerOf("fr", french);
  const read = (analyzer: Analyzer, text: string) => analyzer.analyze(text, { level: "A1" }).tokens.map((token) => `${token.surface}=${token.code ?? token.kind}`).join(" ");

  it("reads French être, the verb after a subject, the pronoun before a verb and the noun after an article", () => {
    expect(read(fr, "C'est content.")).toBe("C'=ce-pron est=être content=content");
    expect(read(fr, "Quel est ton nom ?")).toMatch(/^Quel=quel est=être/);
    expect(read(fr, "Ce n'est pas grand.")).toBe("Ce=ce-pron n'=ne est=être pas=pas grand=grand");
    expect(read(fr, "Je suis content.")).toBe("Je=je suis=être content=content");
    expect(read(fr, "Il porte la porte.")).toBe("Il=il porte=porter la=la porte=porte");
    expect(read(fr, "Je la porte.")).toBe("Je=je la=la-pron porte=porter");
    expect(read(fr, "Ferme la porte.")).toBe("Ferme=fermer la=la porte=porte");
    expect(read(fr, "Je bois de l'eau.")).toMatch(/^Je=je bois=boire de=de/);
    expect(read(fr, "Il vit.")).toBe("Il=il vit=vivre");
    expect(read(fr, "En été.")).toBe("En=en été=été");
    expect(read(fr, "S'il pleut.")).toBe("S'=si il=il pleut=pleuvoir");
  });

  it("reads French plus, quand, a participle after être and a reflexive pronoun of the same person", () => {
    expect(read(fr, "Il est plus grand.")).toBe("Il=il est=être plus=plus grand=grand");
    expect(read(fr, "Je ne bois plus.")).toBe("Je=je ne=ne bois=boire plus=plus-2");
    expect(read(fr, "Quand il pleut, je pars.")).toMatch(/^Quand=quand-conj/);
    expect(read(fr, "Tu pars quand ?")).toMatch(/quand=quand$/);
    expect(read(fr, "La porte est fermée.")).toMatch(/fermée=fermé$/);
    expect(read(fr, "Je t'appelle demain.")).toBe("Je=je t'=te appelle=appeler demain=demain");
    expect(read(fr, "Vous ne trouvez pas ?")).toBe("Vous=vous ne=ne trouvez=trouver pas=pas");
    expect(read(fr, "Vous vous trouvez demain ?")).toBe("Vous=vous vous=vous trouvez=se trouver demain=demain");
  });

  it("keeps a French phrase to its own form and place: je veux, venir de Paris, avoir mal dormi", () => {
    expect(read(fr, "Je veux manger.")).toBe("Je=je veux=vouloir manger=manger");
    expect(read(fr, "Je voudrais manger.")).toBe("Je voudrais=je voudrais manger=manger");
    expect(read(fr, "Je viens de manger.")).toBe("Je=je viens de=venir de manger=manger");
    expect(read(fr, "Je viens de la porte.")).toMatch(/viens=venir de=de/);
    expect(read(fr, "J'ai mal dormi.")).toBe("J'=je ai=avoir mal=mal dormi=dormir");
  });

  it("prefers a reading the learner already knows when the context allows it", () => {
    const later = words("fr", [line("la", "det", "", "", "حرف تعریف", "حرف تعریف", "function", "no_card:1"), line("être", "verb", "", "", "بودن", "بودن", "function"), line("porte", "noun", "f", "portes", "در", "در", "home"), line("fermer", "verb", "", "", "بستن", "بستن", "actions"), line("fermé", "adj", "", "", "بسته", "بسته", "qualities")]);
    // fermer comes before porte, fermé after it: «fermée» in a sentence of porte is the verb's participle.
    const order: Record<string, number> = { la: 1, être: 2, fermer: 3, porte: 4, fermé: 5 };
    for (const item of later) item.order = order[item.word.code];
    const analyzer = analyzerOf("fr", later);
    const porte = later.find((item) => item.word.code === "porte")!;
    const analysis = analyzer.analyze("La [porte] est fermée.", { level: "A1", target: porte });
    expect(analysis.errors).toEqual([]);
    expect(analysis.tokens.at(-1)?.code).toBe("fermer");
  });

  const german = words("de", [
    line("ich", "pron", "", "", "من", "من", "function", "no_card:1"),
    line("es", "pron", "", "", "آن", "es: آن", "function", "no_card:1"),
    line("der", "det", "", "", "حرف تعریف", "der: حرف تعریف", "function", "no_card:1"),
    line("das", "det", "", "", "حرف تعریف", "das: حرف تعریف", "function", "no_card:1"),
    line("kein", "det", "", "", "هیچ", "kein: نفی", "function", "no_card:1"),
    line("hier", "adv", "", "", "اینجا", "اینجا", "space"),
    line("wissen", "verb", "", "", "دانستن", "دانستن", "abstract"),
    line("weiß", "adj", "", "", "سفید", "سفید", "colors"),
    line("bitten", "verb", "", "", "خواهش کردن", "خواهش کردن", "actions"),
    line("bitte", "interj", "", "", "لطفاً", "لطفاً", "people"),
    line("sein", "verb", "", "", "بودن", "بودن", "function"),
    line("Laden", "noun", "der", "Läden", "مغازه", "مغازه", "shopping"),
    line("schließen", "verb", "", "", "بستن", "بستن", "actions"),
    line("geschlossen", "adj", "", "", "بسته", "بسته", "qualities"),
    line("zu", "prep", "", "", "به", "zu: به", "function", "no_card:1"),
    line("zu", "adv", "", "", "بیش از حد", "بیش از حد", "qualities", "code:zu-adv"),
    line("spät", "adj", "", "", "دیر", "دیر", "qualities"),
    line("rufen", "verb", "", "", "صدا زدن", "صدا زدن", "actions"),
    line("anrufen", "verb", "", "", "زنگ زدن", "زنگ زدن", "media"),
    line("morgen", "adv", "", "", "فردا", "فردا", "time"),
    line("weil", "conj", "", "", "چون", "چون", "function"),
    line("ankommen", "verb", "", "", "رسیدن", "رسیدن", "transport"),
    line("Bus", "noun", "der", "Busse", "اتوبوس", "اتوبوس", "transport"),
    line("fahren", "verb", "", "", "رفتن", "رفتن", "transport"),
    line("Bus fahren", "phrase", "", "", "با اتوبوس رفتن", "با اتوبوس رفتن", "transport", "parts:Bus fahren"),
    line("geben", "verb", "", "", "دادن", "دادن", "actions"),
    line("es gibt", "phrase", "", "", "هست", "وجود داشتن", "function", "parts:geben"),
    line("Wasser", "noun", "das", "", "آب", "آب", "drink", "number:sg_only"),
    line("stehen", "verb", "", "", "ایستادن", "ایستادن", "actions"),
    line("aufstehen", "verb", "", "", "برخاستن", "برخاستن", "actions"),
    line("tun", "verb", "", "", "انجام دادن", "انجام دادن", "actions"),
    line("wehtun", "verb", "", "", "درد کردن", "درد کردن", "health"),
  ]);
  const de = new Analyzer("de", german, new Morph("de", german), new Set(["Anna"]));

  it("reads German verbs next to their subject, words written as their lemma, and adjectives after sein", () => {
    expect(read(de, "Ich weiß es.")).toBe("Ich=ich weiß=wissen es=es");
    expect(read(de, "Das weiß ich.")).toBe("Das=das weiß=wissen ich=ich");
    expect(read(de, "Das ist weiß.")).toBe("Das=das ist=sein weiß=weiß");
    expect(read(de, "weil ich es weiß.")).toMatch(/weiß=wissen$/);
    expect(read(de, "Bitte hier.")).toBe("Bitte=bitte hier=hier");
    expect(read(de, "Ich bitte es.")).toBe("Ich=ich bitte=bitten es=es");
    expect(read(de, "Der Laden ist geschlossen.")).toMatch(/geschlossen=geschlossen$/);
    expect(read(de, "Es ist zu spät.")).toBe("Es=es ist=sein zu=zu-adv spät=spät");
    expect(read(de, "Ich stehe hier.")).toBe("Ich=ich stehe=stehen hier=hier");
    expect(read(de, "Ich tun es.").split(" ")[1]).toBe("tun=tun");
  });

  it("joins German separable verbs in the imperative and at the end of a clause, and keeps phrases to their place", () => {
    expect(read(de, "Ruf mich morgen an.")).toMatch(/^Ruf \.\.\. an=anrufen/);
    expect(read(de, "weil ich morgen ankomme.")).toBe("weil=weil ich=ich morgen=morgen ankomme=ankommen");
    expect(read(de, "Ich stehe morgen auf und fahre Bus.")).toMatch(/^Ich=ich stehe \.\.\. auf=aufstehen morgen=morgen/);
    expect(read(de, "Der Bus fährt.")).toBe("Der=der Bus=Bus fährt=fahren");
    expect(read(de, "Ich fahre Bus.")).toBe("Ich=ich fahre Bus=Bus fahren");
    expect(read(de, "Hier gibt es kein Wasser.")).toBe("Hier=hier gibt es=es gibt kein=kein Wasser=Wasser");
    expect(read(de, "Gib es Anna.")).toBe("Gib=geben es=es Anna=name");
  });
});

describe("grammar units of a pack", () => {
  it("builds the unit, its targets, transforms and translations", () => {
    const unit = level.units[0];
    expect(unit.listItem).toMatchObject({ unit_code: "fr-a1-etre", level: "A1" });
    const answer = unit.answer as { targets: { marked_text: string; blanks: number; distractors: unknown }[]; transforms: unknown[]; translations: unknown[] };
    expect(answer.targets[2]).toMatchObject({ marked_text: "Nous {{sommes}} dans la maison et vous {{êtes}} dans la voiture.", blanks: 2, distractors: [["sont", "êtes", "suis"], ["sommes", "es", "sont"]] });
    expect(answer.transforms).toHaveLength(1);
    expect(answer.translations).toHaveLength(1);
  });

  it("names what is wrong in a unit file, with the line", () => {
    const analyzer = analyzerOf("fr", pack.words);
    const text = ["code: x", "title: عنوان", "colour: red", "lesson:", "درس", "targets:", "Je [suis] petit. | من کوچکم. | d: es, est"].join("\n");
    const built = buildGrammar(analyzer, [{ file: "u.txt", text }], "A1");
    const lines = built.errors.map((item) => `${item.line}: ${item.text}`);
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^3: unknown header line/), expect.stringMatching(/^1: missing header «rule:»/), expect.stringMatching(/^7: d: needs three wrong options/)]));
  });
});

describe("phonics lessons of a pack", () => {
  it("builds a lesson of the teacher's list with its place, kind and paragraphs", () => {
    expect(level.phonics).toHaveLength(1);
    const lesson = level.phonics[0];
    expect(lesson).toMatchObject({ order_no: 2, kind: "contrast", label: "u و ou" });
    expect(lesson.record).toMatchObject({ graphemes: ["u", "û", "ou", "où"], minimal_pairs: expect.arrayContaining([{ a: "tu", b: "tout", a_fa: "تو", b_fa: "همه" }]) });
    expect((lesson.record.example_words as { wrong_spellings: string[] }[])[0].wrong_spellings).toEqual(["tou", "teu"]);
    expect(lesson.record.tip_fa).toMatch(/نگه دار\.\n\nou/);
    expect(pack.levels.slice(1).every((other) => other.phonics.length === 0)).toBe(true);
  });

  it("refuses a lesson outside the list, another kind, too few words and letters of another language", () => {
    const lesson = (head: string[], words: string[]) => ["tip:", "نکته‌ای کوتاه.", "words:", ...words].join("\n").replace(/^/, `${head.join("\n")}\n`);
    const built = buildPhonics(
      [
        { file: "a.txt", text: lesson(["label: ä و a", "kind: contrast"], ["tu | تو | tou, teu"]) },
        { file: "b.txt", text: lesson(["label: u و ou", "kind: rule"], ["tu | تو | tou, teu"]) },
        { file: "c.txt", text: lesson(["label: e خاموش", "kind: rule"], ["table | میز | täble, tabl"]) },
      ],
      "fr",
    );
    const errors = built.errors.map((item) => `${item.file}: ${item.text}`);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^a\.txt: «ä و a» is not a lesson/),
        expect.stringMatching(/^b\.txt: the list gives «u و ou» the kind contrast/),
        expect.stringMatching(/^c\.txt: «täble» has letters that are not fr/),
        expect.stringMatching(/^c\.txt: .*example_words/),
      ]),
    );
    expect(built.lessons).toEqual([]);
  });
});

describe("situational dialogues of a pack", () => {
  it("builds a dialogue whose lines and choices are mapped like text sentences", () => {
    expect(level.dialogues).toHaveLength(1);
    const dialogue = level.dialogues[0];
    expect(dialogue).toMatchObject({ code: "fr-a1-d001", level: "A1", situation: "یک همسایه درباره خانه‌ات از تو می‌پرسد." });
    type Sentence = { speaker?: string | null; text: string; tokens: { surface: string; code: string | null }[] };
    const turns = (dialogue.answer.dialogue as { turns: { line: Sentence; choices: Sentence[]; correct: number; why_fa: string }[] }).turns;
    expect(turns.map((turn) => turn.correct)).toEqual([0, 1, 2, 0, 1]);
    expect(turns[0].line).toMatchObject({ speaker: "B", text: "Vous avez une maison ?" });
    expect(turns[0].choices[0]).not.toHaveProperty("speaker");
    // A wrong choice keeps its wrong form, mapped to the word it misuses.
    expect(turns[0].choices[1].tokens.find((token) => token.surface === "un")?.code).toBe("un");
    expect(turns[1].choices[0].tokens.find((token) => token.surface === "Il")?.code).toBe("il");
    expect(dialogue.codes).toEqual(expect.arrayContaining(["maison", "chat", "pain", "aimer"]));
  });

  it("names a turn without one right choice or a why, and a right choice always in one place", () => {
    const analyzer = analyzerOf("fr", pack.words);
    const turn = (marks: string) =>
      ["B: Vous avez une maison ? | خانه دارید؟", `${marks[0]} J'ai une maison. | خانه دارم.`, `${marks[1]} Je suis une maison. | من خانه‌ام.`, `${marks[2]} J'ai un chat. | گربه دارم.`, "why: دلیل."];
    const text = ["code: fr-a1-d009", "title: عنوان", "situation: موقعیت.", "turns:", ...turn("+--"), ...turn("+--"), ...turn("+--"), ...turn("++-").slice(0, 4)].join("\n");
    const built = buildDialogues(analyzer, [{ file: "d.txt", text }], "A1", "fr");
    const errors = built.errors.map((item) => item.text);
    expect(errors).toEqual(expect.arrayContaining(["a turn needs exactly one «+» choice, not 2", "a turn needs «why:»", "the right choice is in the same place in every turn; move it"]));
    expect(built.dialogues).toEqual([]);
  });
});

describe("answers of a unit", () => {
  it("keeps a {code} mark out of the transforms and translations a learner types", () => {
    const analyzer = analyzerOf("fr", pack.words);
    const text = [
      "code: fr-a1-x",
      "title: عنوان",
      "scope: être",
      "rule: قاعده",
      "mistake: اشتباه",
      "lesson:",
      "درس",
      "transforms:",
      "Il est grand. => Elle est grande{grand}. | جمله را با elle بنویس.",
      "translations:",
      "او (زن) بزرگ است. => Elle est grande{grand}.",
    ].join("\n");
    const built = buildGrammar(analyzer, [{ file: "u.txt", text }], "A1");
    const answer = built.units[0].answer as { transforms: { accepted_outputs: string[] }[]; translations: { accepted_outputs: string[] }[] };
    expect(answer.transforms[0].accepted_outputs).toEqual(["Elle est grande."]);
    expect(answer.translations[0].accepted_outputs).toEqual(["Elle est grande."]);
  });
});

describe("conjugation tables of a pack", () => {
  it("links each table to the most specific unit of its tense and marks review cards", () => {
    const table = (code: string, tense: string) => level.tables.find((item) => item.verb.word.code === code && item.tense === tense)!;
    expect(table("être", "présent")).toMatchObject({ unit_code: "fr-a1-etre", review_card: true });
    expect(table("parler", "présent")).toMatchObject({ unit_code: "fr-a1-er", review_card: true }); // the -er sample
    expect(table("aimer", "présent")).toMatchObject({ unit_code: "fr-a1-er", review_card: false });
    expect(table("aller", "passé composé").accepted_variants.je).toEqual(["suis allée"]);
  });

  it("reads German verb classes from the data: modal, separable, sein, irregular", () => {
    const list = words("de", [
      "machen\tverb\t\t\tانجام دادن\tانجام دادن\tactions",
      "spielen\tverb\t\t\tبازی کردن\tبازی کردن\tleisure",
      "kommen\tverb\t\t\tآمدن\tآمدن\ttravel",
      "fahren\tverb\t\t\tراندن\tراندن\ttransport",
      "können\tverb\t\t\tتوانستن\tتوانستن\tfunction",
      "aufstehen\tverb\t\t\tبلند شدن\tبلند شدن\tactions",
    ]);
    const units = [
      { unit_code: "praesens", level: "A1", order: 1, file: "a", tables: [{ tense: "Präsens", verbClass: null }, { tense: "Präsens", verbClass: "modal" }] },
      { unit_code: "perfekt", level: "A1", order: 2, file: "b", tables: [{ tense: "Perfekt", verbClass: null }] },
      { unit_code: "perfekt-sein", level: "A1", order: 3, file: "c", tables: [{ tense: "Perfekt", verbClass: "aux-sein" }] },
      { unit_code: "kj2", level: "B1", order: 1, file: "d", tables: [{ tense: "Konjunktiv II", verbClass: null }] },
    ];
    const built = buildTables("de", list, appSettingDefaults["conjugation.tenses.de"] as Record<string, string[]>, units);
    const table = (verb: string, tense: string) => built.tables.find((item) => item.verb.word.code === verb && item.tense === tense)!;
    expect(table("können", "Präsens")).toMatchObject({ unit_code: "praesens", review_card: true });
    expect(table("spielen", "Präsens").review_card).toBe(false);
    expect(table("fahren", "Präsens").review_card).toBe(true); // du fährst
    expect(table("kommen", "Präsens").review_card).toBe(false);
    expect(table("aufstehen", "Präsens").forms.ich).toBe("stehe auf");
    expect(table("aufstehen", "Perfekt")).toMatchObject({ unit_code: "perfekt-sein", forms: { ich: "bin aufgestanden" } });
    expect(table("machen", "Perfekt").unit_code).toBe("perfekt");
    expect(table("kommen", "Konjunktiv II").accepted_variants.du).toEqual(["würdest kommen", "kämst"]);
    expect(table("können", "Konjunktiv II").accepted_variants.du).toEqual(["würdest können"]);
    // B1 has a unit, so its other tenses need one too; B2 has none yet, so its tables wait.
    expect(built.errors.map((item) => item.text)).toEqual([
      "no grammar unit says «tables: Futur I»: its tables have no unit",
      "no grammar unit says «tables: Plusquamperfekt»: its tables have no unit",
    ]);
    expect(built.notes.map((item) => item.text)).toContain("no grammar unit says «tables: Konjunktiv I»: its tables have no unit (waits for the B2 grammar)");
  });

  it("keeps the e of «lecker», drops it in «teuer» and «dunkel»", () => {
    const forms = (lemma: string) => germanAdjectiveForms(lemma).map((item) => item.form);
    expect(forms("lecker")).toContain("leckeres");
    expect(forms("teuer")).toContain("teures");
    expect(forms("dunkel")).toContain("dunkles");
  });

  it("reads a German infinitive form next to wir, sie or Sie as finite, and never offers a near-synonym", () => {
    const list = words("de", [
      "wir\tpron\t\t\tما\tما\tfunction\tno_card:1",
      "was\tpron\t\t\tچه\tچه\tfunction\tno_card:1",
      "Sie\tpron\t\t\tشما (رسمی)\tشما رسمی\tfunction\tno_card:1",
      "ich\tpron\t\t\tمن\tمن\tfunction\tno_card:1",
      "möchten\tverb\t\t\tخواستن (مؤدبانه)، میل داشتن\tخواستن مؤدبانه\tfunction",
      "wollen\tverb\t\t\tخواستن\tخواستن\tfunction",
      "trinken\tverb\t\t\tنوشیدن\tنوشیدن\tdrink",
      "kaufen\tverb\t\t\tخریدن\tخریدن\tshopping",
      "einkaufen\tverb\t\t\tخرید کردن\tخرید کردن\tshopping",
      "bezahlen\tverb\t\t\tپرداختن\tپرداختن\tshopping",
      "kosten\tverb\t\t\tقیمت داشتن\tقیمت داشتن\tshopping",
      "verkaufen\tverb\t\t\tفروختن\tفروختن\tshopping",
    ]);
    const out = buildSentences(analyzerOf("de", list), [{ file: "s.txt", text: "# möchten\nWas [möchten] Sie trinken? | چه میل دارید بنوشید؟\n# kaufen\nIch möchte [kaufen]. | می‌خواهم بخرم." }], "A1", new Set(list));
    expect(out.errors).toEqual([]);
    expect(out.records[0].targets[0]).toMatchObject({ distractors: ["möchte", "möchtest", "möchtet"], hint: "(möchten)" });
    expect(out.records[1].targets[0].distractors).not.toContain("einkaufen");
    expect(nearMeaning("خواستن (مؤدبانه)، میل داشتن", "خواستن")).toBe(true);
    expect(nearMeaning("دوست داشتن", "خیلی دوست داشتن")).toBe(true);
    expect(nearMeaning("خریدن", "فروختن")).toBe(false);
    expect(nearMeaning("چه کسی، کی", "چه، چه چیزی")).toBe(false); // qui, que
  });

  it("offers the other forms of a function word, and keeps verb phrases and other phrases apart", () => {
    const list = words("fr", [
      "le\tdet\t\t\tحرف تعریف معین\tle: حرف تعریف معین\tfunction\tno_card:1",
      "tu\tpron\t\t\tتو\ttu: تو\tfunction\tno_card:1",
      "être\tverb\t\t\tبودن\tبودن\tfunction",
      "avoir\tverb\t\t\tداشتن\tداشتن\tfunction",
      "faire\tverb\t\t\tانجام دادن\tانجام دادن\tactions",
      "aimer\tverb\t\t\tدوست داشتن\tدوست داشتن\tfeelings",
      "quel\tdet\t\t\tکدام، چه جور\tکدام\tfunction",
      "tout\tdet\t\t\tهمه، همهٔ\tهمه\tfunction",
      "heure\tnoun\tf\t\tساعت\tساعت\ttime",
      "ville\tnoun\tf\t\tشهر\tشهر\tcity",
      "faim\tnoun\tf\t\tگرسنگی\tگرسنگی\tfood\tnumber:sg_only",
      "soif\tnoun\tf\t\tتشنگی\tتشنگی\tdrink\tnumber:sg_only",
      "nuit\tnoun\tf\t\tشب\tشب\ttime",
      "bon\tadj\t\t\tخوب\tخوب\tqualities",
      "bientôt\tadv\t\t\tبه‌زودی\tبه‌زودی\ttime",
      "avoir faim\tphrase\t\t\tگرسنه بودن\tگرسنه بودن\tfood\tparts:avoir faim",
      "avoir soif\tphrase\t\t\tتشنه بودن\tتشنه بودن\tdrink\tparts:avoir soif",
      "faire attention\tphrase\t\t\tمراقب بودن\tمراقب بودن\tactions\tparts:faire",
      "avoir raison\tphrase\t\t\tحق داشتن\tحق داشتن\tabstract\tparts:avoir",
      "bonne nuit\tphrase\t\t\tشب بخیر\tشب بخیر\ttime\tparts:bon nuit",
      "à bientôt\tphrase\t\t\tبه‌زودی می‌بینمت\tتا دیدار بعد\ttime\tparts:bientôt",
      "bon appétit\tphrase\t\t\tنوش جان\tنوش جان\tfood\tparts:bon",
      "s'il te plaît\tphrase\t\t\tلطفاً\tلطفاً\tpeople\tparts:tu",
    ]);
    const text = ["# quel", "[Quelle] heure ? | ساعت چند است؟", "# tout", "Tu aimes [toute] la ville. | تو همهٔ شهر را دوست داری.", "# bonne nuit", "[Bonne nuit] ! | شب بخیر!"].join("\n");
    const out = buildSentences(analyzerOf("fr", list), [{ file: "s.txt", text }], "A1", new Set(list));
    expect(out.errors).toEqual([]);
    const [quel, tout, nuit] = out.records.map((record) => record.targets[0]);
    expect(quel.distractors).toEqual(["Quel", "Quels", "Quelles"]);
    expect(tout.distractors).toEqual(["tout", "tous", "toutes"]);
    expect(nuit.distractors).toHaveLength(3);
    expect(nuit.distractors.some((option) => /faim|soif|attention|raison/.test(option))).toBe(false);
  });

  it("writes German in today's spelling and makes the verbs Morphy lacks from their parts", () => {
    const forms = (verb: string, tense: string) => Object.values(standardTable("de", verb, tense)?.forms ?? {});
    expect(forms("müssen", "Präsens")).toEqual(["muss", "musst", "muss", "müssen", "müsst", "müssen"]);
    expect(forms("schließen", "Präteritum")[0]).toBe("schloss");
    expect(forms("essen", "Präteritum")[0]).toBe("aß"); // a long vowel keeps ß
    expect(forms("wissen", "Präsens")[0]).toBe("weiß");
    expect(forms("mitkommen", "Perfekt")[0]).toBe("bin mitgekommen");
    expect(forms("sich ausruhen", "Präsens")[0]).toBe("ruhe mich aus");
    expect(forms("möchten", "Präsens")).toEqual(["möchte", "möchtest", "möchte", "möchten", "möchtet", "möchten"]);
    // Morphy files these as separable; their participles say they are not.
    expect(forms("wiederholen", "Präsens")[0]).toBe("wiederhole");
    expect(forms("übersetzen", "Perfekt")[0]).toBe("habe übersetzt");
    expect(forms("unterschreiben", "Präteritum")[0]).toBe("unterschrieb");
    expect(forms("umstellen", "Präsens")[0]).toBe("stelle um");
    expect(forms("umstellen", "Perfekt")[0]).toBe("habe umgestellt");
    const list = words("de", ["müssen\tverb\t\t\tمجبور بودن\tباید\tfunction", "mitkommen\tverb\t\t\tهمراه آمدن\tهمراه آمدن\ttravel", "ich\tpron\t\t\tمن\tمن\tfunction\tno_card:1", "du\tpron\t\t\tتو\tتو\tfunction\tno_card:1"]);
    const analysis = analyzerOf("de", list).analyze("Ich muss. Kommst du mit?", { level: "A1" });
    expect(analysis.errors).toEqual([]);
    expect(analysis.tokens.map((token) => `${token.surface}=${token.code}`)).toEqual(["Ich=ich", "muss=müssen", "Kommst ... mit=mitkommen", "du=du"]);
  });
});

describe("find the mistake, writing and A2 texts in a pack", () => {
  it("keeps the marks and drops {code} in the stored text, and reads the corrected one", () => {
    expect(splitMarked("Il {{es|est}} grand{grand} et nous {{mange|mangeons}}{manger}.")).toEqual({
      marked: "Il {{es|est}} grand et nous {{mange|mangeons}}.",
      corrected: "Il est grand{grand} et nous mangeons{manger}.",
    });
  });

  it("checks the marks, the explanations and the units of a find-the-mistake item", () => {
    const analyzer = analyzerOf("fr", pack.words);
    const text = ["units: fr-a1-etre, fr-a9-nothing", "text: Le chat {{es|est}} petit.", "fa: گربه کوچک است.", "why: با il شکل est است."].join("\n");
    const built = buildErrorfix(analyzer, [{ file: "e.txt", text }], "A1", new Set(["fr-a1-etre"]));
    const errors = built.errors.map((item) => item.text);
    expect(errors).toContain("«fr-a9-nothing» is not a grammar unit of A1 or below");
    expect(errors.some((error) => error.includes("marked_text"))).toBe(true);
    expect(built.items).toEqual([]);
    expect(level.errorfix.map((item) => item.key)).toEqual(["Le chat est petit et nous mangeons une pomme.", "La femme est triste et le garçon est triste."]);
  });

  it("checks a writing task's range, lists and model answer", () => {
    const analyzer = analyzerOf("fr", pack.words);
    const text = ["prompt: درباره خانه‌ات بنویس.", "words: 10-200", "checklist:", "- یک صفت", "phrases:", "La maison | خانه", "model:", "La maison est belle.", "model_fa:", "خانه زیباست."].join("\n");
    const built = buildWriting(analyzer, [{ file: "w.txt", text }], "B1", [60, 120]);
    expect(built.tasks).toEqual([]);
    expect(built.errors.length).toBeGreaterThanOrEqual(3);
    expect(level.writing).toHaveLength(1);
  });

  it("gives an A2 text the band it names, with that band's kinds and length", () => {
    const analyzer = analyzerOf("fr", pack.words);
    const text = (band: string, kind: string) => [`code: fr-a2-t001`, "title: La maison", band, `kind: ${kind}`, "sentences:", "- La maison est petite. | خانه کوچک است."].join("\n");
    const two = buildTexts(analyzer, [{ file: "t.txt", text: text("band: 2", "email") }], "A2");
    expect(two.errors.map((item) => item.text)).toContain("4 words; band 2 needs 60 to 120");
    const wrong = buildTexts(analyzer, [{ file: "t.txt", text: text("band: 3", "news") }], "A2");
    expect(wrong.errors.map((item) => item.text)).toContain("band «3» is not a band of A2 (1, 2)");
    const kind = buildTexts(analyzer, [{ file: "t.txt", text: text("band: 2", "menu") }], "A2");
    expect(kind.errors.map((item) => item.text)).toContain("kind «menu» is not a kind of band 2");
  });
});
