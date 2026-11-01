/**
 * Three phonics lessons of the French demo (DECISIONS.md, «محتوای نمونه فرانسوی»), one of each kind
 * (PRD §8.1), written by hand with the labels of the teacher's list (`phonics.lessons.fr`), so the panel
 * never offers them again. Wrong spellings are never another spelling of the same sound, so a P1
 * question has one right answer; liaison sentences have only the obligatory ties and no optional one.
 */

export type DemoPhonics = {
  /** Its place in the teacher's list. */
  orderNo: number;
  lesson: {
    kind: "contrast" | "rule" | "liaison";
    sound_label: string;
    graphemes: string[];
    tip_fa: string;
    example_words: { text: string; meaning_fa: string; wrong_spellings: [string, string] }[];
    minimal_pairs: { a: string; b: string; a_fa: string; b_fa: string }[];
    liaison_sentences: { text: string; liaison_after_word_index: number[] }[];
  };
};

export const demoPhonics: DemoPhonics[] = [
  {
    orderNo: 1,
    lesson: {
      kind: "rule",
      sound_label: "حرف‌های خاموش: آخر کلمه و h",
      graphemes: ["-t", "-d", "-s", "-x", "-z", "-p", "h"],
      tip_fa:
        "در فرانسوی حرف‌های بی‌صدای آخر کلمه بیشتر وقت‌ها خوانده نمی‌شوند: t، d، s، x، z و p. پس petit «پُتی» خوانده می‌شود و grand «گران».\n\nحرف h هم هیچ‌وقت خوانده نمی‌شود: homme «اُم» است. فقط c، r، f و l آخر کلمه معمولاً خوانده می‌شوند.",
      example_words: [
        { text: "petit", meaning_fa: "کوچک", wrong_spellings: ["peti", "petie"] },
        { text: "grand", meaning_fa: "بزرگ", wrong_spellings: ["gran", "grant"] },
        { text: "trois", meaning_fa: "سه", wrong_spellings: ["troi", "troa"] },
        { text: "deux", meaning_fa: "دو", wrong_spellings: ["deu", "deus"] },
        { text: "nez", meaning_fa: "بینی", wrong_spellings: ["nè", "nes"] },
        { text: "trop", meaning_fa: "خیلی زیاد", wrong_spellings: ["tro", "trau"] },
        { text: "homme", meaning_fa: "مرد", wrong_spellings: ["omme", "home"] },
        { text: "hôtel", meaning_fa: "هتل", wrong_spellings: ["ôtel", "otel"] },
      ],
      minimal_pairs: [],
      liaison_sentences: [],
    },
  },
  {
    orderNo: 2,
    lesson: {
      kind: "contrast",
      sound_label: "u و ou",
      graphemes: ["u", "û", "ou", "où"],
      tip_fa:
        "u فرانسوی در فارسی نیست: لب‌ها را برای «او» گرد و جلو بیاور، ولی زبان را جای «ای» نگه دار. ou همان «او» فارسی است.\n\nاین دو صدا معنی کلمه را عوض می‌کنند: tu یعنی «تو» و tout یعنی «همه».",
      example_words: [
        { text: "tu", meaning_fa: "تو", wrong_spellings: ["tou", "teu"] },
        { text: "rue", meaning_fa: "خیابان", wrong_spellings: ["rou", "reu"] },
        { text: "vu", meaning_fa: "دیده", wrong_spellings: ["vou", "veu"] },
        { text: "sur", meaning_fa: "روی", wrong_spellings: ["sour", "sir"] },
        { text: "tout", meaning_fa: "همه", wrong_spellings: ["tu", "tut"] },
        { text: "jour", meaning_fa: "روز", wrong_spellings: ["jur", "jeur"] },
        { text: "vous", meaning_fa: "شما", wrong_spellings: ["vu", "vus"] },
        { text: "loup", meaning_fa: "گرگ", wrong_spellings: ["lu", "lup"] },
      ],
      minimal_pairs: [
        { a: "tu", b: "tout", a_fa: "تو", b_fa: "همه" },
        { a: "rue", b: "roue", a_fa: "خیابان", b_fa: "چرخ" },
        { a: "vu", b: "vous", a_fa: "دیده", b_fa: "شما" },
        { a: "dessus", b: "dessous", a_fa: "رویش", b_fa: "زیرش" },
        { a: "lu", b: "loup", a_fa: "خوانده", b_fa: "گرگ" },
        { a: "bu", b: "bout", a_fa: "نوشیده", b_fa: "انتها" },
      ],
      liaison_sentences: [],
    },
  },
  {
    orderNo: 14,
    lesson: {
      kind: "liaison",
      sound_label: "liaison و enchaînement",
      graphemes: ["s", "x", "z", "t", "n"],
      tip_fa:
        "وقتی کلمه بعدی با صدای واکه یا h خاموش شروع شود، حرف آخرِ خاموشِ کلمه قبل گاهی خوانده می‌شود و دو کلمه به هم وصل می‌شوند. به این liaison می‌گویند: les amis «لِزامی» خوانده می‌شود.\n\ns و x مثل «ز» خوانده می‌شوند. بعد از les، des، mes، un، mon، deux، trois، nous، vous، ils و elles این وصل همیشه هست.",
      example_words: [],
      minimal_pairs: [],
      liaison_sentences: [
        { text: "Les amis sont là.", liaison_after_word_index: [0] },
        { text: "Vous avez deux enfants.", liaison_after_word_index: [0, 2] },
        { text: "Ils ont faim.", liaison_after_word_index: [0] },
        { text: "Un petit enfant mange.", liaison_after_word_index: [1] },
        { text: "Mon ami est grand.", liaison_after_word_index: [0] },
        { text: "Nous aimons les arbres.", liaison_after_word_index: [0, 2] },
        { text: "Deux hommes parlent.", liaison_after_word_index: [0] },
        { text: "Trois oiseaux chantent.", liaison_after_word_index: [0] },
        { text: "Mes amis sont très gentils.", liaison_after_word_index: [0] },
        { text: "Un enfant joue dehors.", liaison_after_word_index: [0] },
      ],
    },
  },
];
