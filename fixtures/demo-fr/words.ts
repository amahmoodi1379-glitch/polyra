/**
 * The words of the French demo (DECISIONS.md, «محتوای نمونه فرانسوی»): 60 A1 card words in the order a
 * learner meets them, and the small words their sentences need, which never get a card. Written by
 * hand for the tester account; `npm run demo -- remove` takes them out again.
 */

export type Slot = "ms" | "fs" | "mp" | "fp";

type Base = { code: string; meaning: string; note?: string; family?: string; homophones?: string[]; collocations?: { text: string; translation_fa: string }[] };

export type NounDef = Base & { pos: "noun"; gender: "m" | "f"; plural: string | null; kind: "person" | "animal" | "food" | "drink" | "place" | "thing" | "time" | "language" };
export type AdjDef = Base & { pos: "adj"; forms: Record<Slot, string> };
export type VerbDef = Base & { pos: "verb" };
export type SmallDef = Base & { pos: "adv" | "interj" };
export type CardWord = NounDef | AdjDef | VerbDef | SmallDef;

const adj = (ms: string, fs: string, mp: string, fp: string): Record<Slot, string> => ({ ms, fs, mp, fp });

/** Card words in teaching order: each word's sentences use only words before it, where they can. */
export const cardWords: CardWord[] = [
  { code: "bonjour", pos: "interj", meaning: "سلام، روز بخیر", note: "هم رسمی است هم دوستانه؛ تا عصر به کار می‌رود." },
  { code: "merci", pos: "interj", meaning: "ممنون، مرسی" },
  { code: "oui", pos: "adv", meaning: "بله، آره" },
  { code: "non", pos: "adv", meaning: "نه، خیر" },
  { code: "être", pos: "verb", meaning: "بودن", note: "بی‌قاعده است: je suis، tu es، il est." },
  { code: "homme", pos: "noun", gender: "m", plural: "hommes", kind: "person", meaning: "مرد", note: "h خوانده نمی‌شود: l'homme." },
  { code: "femme", pos: "noun", gender: "f", plural: "femmes", kind: "person", meaning: "زن، همسر", note: "«فَم» خوانده می‌شود." },
  { code: "garçon", pos: "noun", gender: "m", plural: "garçons", kind: "person", meaning: "پسر" },
  { code: "fille", pos: "noun", gender: "f", plural: "filles", kind: "person", meaning: "دختر" },
  { code: "ami", pos: "noun", gender: "m", plural: "amis", kind: "person", meaning: "دوست" },
  { code: "avoir", pos: "verb", meaning: "داشتن", note: "بی‌قاعده است: j'ai، tu as، il a." },
  { code: "grand", pos: "adj", forms: adj("grand", "grande", "grands", "grandes"), meaning: "بزرگ، قدبلند" },
  { code: "petit", pos: "adj", forms: adj("petit", "petite", "petits", "petites"), meaning: "کوچک، قدکوتاه" },
  { code: "maison", pos: "noun", gender: "f", plural: "maisons", kind: "place", meaning: "خانه", collocations: [{ text: "à la maison", translation_fa: "در خانه" }] },
  { code: "chat", pos: "noun", gender: "m", plural: "chats", kind: "animal", meaning: "گربه", note: "t آخر خوانده نمی‌شود." },
  { code: "chien", pos: "noun", gender: "m", plural: "chiens", kind: "animal", meaning: "سگ" },
  { code: "livre", pos: "noun", gender: "m", plural: "livres", kind: "thing", meaning: "کتاب" },
  { code: "table", pos: "noun", gender: "f", plural: "tables", kind: "thing", meaning: "میز" },
  { code: "école", pos: "noun", gender: "f", plural: "écoles", kind: "place", meaning: "مدرسه", note: "پیش از آن la می‌شود l': l'école." },
  { code: "ici", pos: "adv", meaning: "اینجا" },
  { code: "très", pos: "adv", meaning: "خیلی" },
  {
    code: "bien",
    pos: "adv",
    meaning: "خوب (قید)، به‌خوبی",
    note: "قید است: Je vais bien. صفتِ «خوب» bon است.",
    collocations: [{ text: "très bien", translation_fa: "خیلی خوب" }],
  },
  { code: "manger", pos: "verb", meaning: "خوردن", note: "با nous یک e می‌گیرد: nous mangeons." },
  { code: "pain", pos: "noun", gender: "m", plural: "pains", kind: "food", meaning: "نان", homophones: ["pin"] },
  { code: "pomme", pos: "noun", gender: "f", plural: "pommes", kind: "food", meaning: "سیب" },
  { code: "fromage", pos: "noun", gender: "m", plural: "fromages", kind: "food", meaning: "پنیر" },
  { code: "bon", pos: "adj", forms: adj("bon", "bonne", "bons", "bonnes"), meaning: "خوب (صفت)، خوشمزه", note: "صفت است: un bon café. مؤنثش bonne است." },
  { code: "eau", pos: "noun", gender: "f", plural: "eaux", kind: "drink", meaning: "آب", note: "مؤنث است، با اینکه به o ختم می‌شود: l'eau.", homophones: ["haut", "oh"] },
  { code: "boire", pos: "verb", meaning: "نوشیدن" },
  { code: "café", pos: "noun", gender: "m", plural: "cafés", kind: "drink", meaning: "قهوه، کافه", collocations: [{ text: "un café au lait", translation_fa: "یک شیرقهوه" }] },
  { code: "lait", pos: "noun", gender: "m", plural: "laits", kind: "drink", meaning: "شیر (نوشیدنی)" },
  { code: "thé", pos: "noun", gender: "m", plural: "thés", kind: "drink", meaning: "چای" },
  { code: "aimer", pos: "verb", meaning: "دوست داشتن" },
  { code: "parler", pos: "verb", meaning: "حرف زدن، صحبت کردن" },
  { code: "français", pos: "noun", gender: "m", plural: null, kind: "language", meaning: "زبان فرانسوی، فرانسوی", note: "نام زبان با حرف کوچک نوشته می‌شود." },
  { code: "habiter", pos: "verb", meaning: "زندگی کردن، ساکن بودن", note: "h خوانده نمی‌شود: j'habite." },
  { code: "ville", pos: "noun", gender: "f", plural: "villes", kind: "place", meaning: "شهر" },
  { code: "rue", pos: "noun", gender: "f", plural: "rues", kind: "place", meaning: "خیابان، کوچه" },
  { code: "voiture", pos: "noun", gender: "f", plural: "voitures", kind: "thing", meaning: "ماشین، خودرو", collocations: [{ text: "en voiture", translation_fa: "با ماشین" }] },
  { code: "aller", pos: "verb", meaning: "رفتن", note: "بی‌قاعده است: je vais، tu vas، il va.", collocations: [{ text: "aller bien", translation_fa: "حالِ خوب داشتن" }] },
  { code: "travail", pos: "noun", gender: "m", plural: "travaux", kind: "place", meaning: "کار", note: "جمعش بی‌قاعده است: travaux." },
  { code: "jour", pos: "noun", gender: "m", plural: "jours", kind: "time", meaning: "روز" },
  { code: "nuit", pos: "noun", gender: "f", plural: "nuits", kind: "time", meaning: "شب", collocations: [{ text: "Bonne nuit !", translation_fa: "شب بخیر!" }] },
  { code: "matin", pos: "noun", gender: "m", plural: "matins", kind: "time", meaning: "صبح" },
  { code: "soir", pos: "noun", gender: "m", plural: "soirs", kind: "time", meaning: "عصر، سرِ شب", collocations: [{ text: "ce soir", translation_fa: "امشب" }] },
  { code: "demain", pos: "adv", meaning: "فردا", collocations: [{ text: "À demain !", translation_fa: "تا فردا!" }] },
  { code: "maintenant", pos: "adv", meaning: "حالا، الان" },
  { code: "aussi", pos: "adv", meaning: "هم، همچنین" },
  { code: "mère", pos: "noun", gender: "f", plural: "mères", kind: "person", family: "famille", meaning: "مادر", homophones: ["mer", "maire"] },
  { code: "père", pos: "noun", gender: "m", plural: "pères", kind: "person", family: "famille", meaning: "پدر", homophones: ["paire"] },
  { code: "frère", pos: "noun", gender: "m", plural: "frères", kind: "person", family: "famille", meaning: "برادر" },
  { code: "sœur", pos: "noun", gender: "f", plural: "sœurs", kind: "person", family: "famille", meaning: "خواهر" },
  { code: "famille", pos: "noun", gender: "f", plural: "familles", kind: "person", meaning: "خانواده" },
  { code: "beau", pos: "adj", forms: adj("beau", "belle", "beaux", "belles"), meaning: "زیبا، قشنگ", note: "مؤنثش belle است." },
  { code: "nouveau", pos: "adj", forms: adj("nouveau", "nouvelle", "nouveaux", "nouvelles"), meaning: "نو، جدید", note: "مؤنثش nouvelle است." },
  { code: "rouge", pos: "adj", forms: adj("rouge", "rouge", "rouges", "rouges"), family: "couleur", meaning: "قرمز" },
  { code: "bleu", pos: "adj", forms: adj("bleu", "bleue", "bleus", "bleues"), family: "couleur", meaning: "آبی" },
  { code: "vert", pos: "adj", forms: adj("vert", "verte", "verts", "vertes"), family: "couleur", meaning: "سبز", homophones: ["verre", "ver", "vers"] },
  { code: "blanc", pos: "adj", forms: adj("blanc", "blanche", "blancs", "blanches"), family: "couleur", meaning: "سفید", note: "مؤنثش blanche است." },
  { code: "noir", pos: "adj", forms: adj("noir", "noire", "noirs", "noires"), family: "couleur", meaning: "سیاه، مشکی" },
];

/** Feminine forms that do not start like the lemma; the panel would ask the teacher about them (PRD §14.1, rule 5). */
export const formExceptions: { code: string; surface: string }[] = [{ code: "beau", surface: "belle" }];

export type SmallWord = { code: string; pos: "pron" | "det" | "prep" | "conj" | "adv"; meaning: string };

/** Words the sentences need that never become cards (no_card, PRD §5.1). */
export const smallWords: SmallWord[] = [
  { code: "je", pos: "pron", meaning: "من" },
  { code: "tu", pos: "pron", meaning: "تو" },
  { code: "il", pos: "pron", meaning: "او (مذکر)" },
  { code: "elle", pos: "pron", meaning: "او (مؤنث)" },
  { code: "nous", pos: "pron", meaning: "ما" },
  { code: "vous", pos: "pron", meaning: "شما" },
  { code: "ils", pos: "pron", meaning: "آن‌ها (مذکر)" },
  { code: "elles", pos: "pron", meaning: "آن‌ها (مؤنث)" },
  { code: "ce", pos: "pron", meaning: "این" },
  { code: "le", pos: "det", meaning: "(حرف تعریف)" },
  { code: "la", pos: "det", meaning: "(حرف تعریف)" },
  { code: "les", pos: "det", meaning: "(حرف تعریف جمع)" },
  { code: "un", pos: "det", meaning: "یک" },
  { code: "des", pos: "det", meaning: "(حرف تعریف جمع)، چند" },
  { code: "du", pos: "det", meaning: "مقداری" },
  { code: "mon", pos: "det", meaning: "مالِ من، ـَم" },
  { code: "ma", pos: "det", meaning: "مالِ من، ـَم" },
  { code: "son", pos: "det", meaning: "مالِ او، ـَش" },
  { code: "de", pos: "prep", meaning: "از" },
  { code: "à", pos: "prep", meaning: "به، در" },
  { code: "au", pos: "prep", meaning: "به" },
  { code: "avec", pos: "prep", meaning: "با" },
  { code: "dans", pos: "prep", meaning: "در، داخلِ" },
  { code: "sur", pos: "prep", meaning: "روی" },
  { code: "et", pos: "conj", meaning: "و" },
  { code: "ou", pos: "conj", meaning: "یا" },
  { code: "ne", pos: "adv", meaning: "(نشانهٔ منفی)" },
  { code: "pas", pos: "adv", meaning: "(نشانهٔ منفی)" },
];

/** Names in the sentences (PRD §14.1, kind "name"). */
export const names = ["Marie", "Paul", "Léa", "Hugo", "Paris", "Lyon"];

export type Person = "je" | "tu" | "il_elle_on" | "nous" | "vous" | "ils_elles";
export const persons: Person[] = ["je", "tu", "il_elle_on", "nous", "vous", "ils_elles"];

/**
 * Present tense of every verb (PRD §14.4 keys) with its Persian, for the meaning shown when a learner
 * taps a verb in a sentence. `stem` + ending makes «می‌خورم»; `plain` verbs take no «می».
 */
export type VerbForms = { forms: string[]; unit: string | null; review: boolean; fa: { prefix?: string; stem: string; plain?: boolean } | { yes: string[]; no: string[] } };

export const verbs: Record<string, VerbForms> = {
  être: {
    forms: ["suis", "es", "est", "sommes", "êtes", "sont"],
    unit: "fr-a1-etre",
    review: true,
    fa: { yes: ["هستم", "هستی", "است", "هستیم", "هستید", "هستند"], no: ["نیستم", "نیستی", "نیست", "نیستیم", "نیستید", "نیستند"] },
  },
  avoir: { forms: ["ai", "as", "a", "avons", "avez", "ont"], unit: "fr-a1-avoir", review: true, fa: { stem: "دار", plain: true } },
  manger: { forms: ["mange", "manges", "mange", "mangeons", "mangez", "mangent"], unit: "fr-a1-er", review: true, fa: { stem: "خور" } },
  boire: { forms: ["bois", "bois", "boit", "buvons", "buvez", "boivent"], unit: null, review: false, fa: { stem: "نوش" } },
  aimer: { forms: ["aime", "aimes", "aime", "aimons", "aimez", "aiment"], unit: "fr-a1-er", review: false, fa: { prefix: "دوست ", stem: "دار", plain: true } },
  parler: { forms: ["parle", "parles", "parle", "parlons", "parlez", "parlent"], unit: "fr-a1-er", review: true, fa: { prefix: "حرف ", stem: "زن" } },
  habiter: { forms: ["habite", "habites", "habite", "habitons", "habitez", "habitent"], unit: "fr-a1-er", review: false, fa: { prefix: "زندگی ", stem: "کن" } },
  aller: { forms: ["vais", "vas", "va", "allons", "allez", "vont"], unit: "fr-a1-aller", review: true, fa: { stem: "رو" } },
};
