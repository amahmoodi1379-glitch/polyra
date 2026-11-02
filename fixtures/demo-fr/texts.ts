/**
 * Seven A1 texts of the French demo (DECISIONS.md, «محتوای نمونه فرانسوی»), band 1, written by hand
 * with the demo's own words only. Each has the four question sets of PRD §14.6, so a tester meets
 * it in either track. Questions of band 1 are in Persian (PRD §7.3).
 */

export type DemoLine = { text: string; fa: string; speaker?: string; meanings?: Record<string, string> };
export type DemoText = {
  code: string;
  title: string;
  kind: "dialogue" | "voice_message" | "menu" | "ad";
  lines: DemoLine[];
  keyWords: string[];
  sets: { listening: { A: unknown[]; B: unknown[] }; reading: { A: unknown[]; B: unknown[] } };
};

export const demoTexts: DemoText[] = [
  {
    code: "fr-a1-t001",
    title: "Au café",
    kind: "dialogue",
    lines: [
      { speaker: "Marie", text: "Bonjour Paul !", fa: "سلام پل!" },
      { speaker: "Paul", text: "Bonjour Marie, tu vas bien ?", fa: "سلام ماری، حالت خوب است؟" },
      { speaker: "Marie", text: "Oui, très bien, merci.", fa: "بله، خیلی خوب، ممنون." },
      { speaker: "Paul", text: "Je bois un café au lait.", fa: "من یک شیرقهوه می‌نوشم." },
      { speaker: "Marie", text: "Je bois du thé avec du lait.", fa: "من چای با شیر می‌نوشم." },
      { speaker: "Paul", text: "Tu manges du pain aussi ?", fa: "نان هم می‌خوری؟" },
      { speaker: "Marie", text: "Non, je mange une pomme.", fa: "نه، یک سیب می‌خورم." },
      { speaker: "Paul", text: "Le fromage ici est très bon.", fa: "پنیرِ اینجا خیلی خوب است." },
    ],
    keyWords: ["boire", "fromage"],
    sets: {
      listening: {
        A: [
          { type: "mcq", prompt: "پل چه می‌نوشد؟", options: ["شیرقهوه", "چای", "آب", "شیر"], correct: 0, explanation_fa: "پل می‌گوید Je bois un café au lait: یک شیرقهوه." },
          { type: "tf", prompt: "حال ماری خوب است.", correct: true, explanation_fa: "ماری می‌گوید très bien, merci." },
          { type: "dict", sentence: 6, explanation_fa: "ماری می‌گوید Non, je mange une pomme: نه، یک سیب می‌خورم." },
        ],
        B: [
          { type: "mcq", prompt: "ماری چه می‌خورد؟", options: ["سیب", "نان", "پنیر", "کیک"], correct: 0, explanation_fa: "ماری می‌گوید je mange une pomme." },
          { type: "tf", prompt: "ماری نان می‌خورد.", correct: false, explanation_fa: "پل می‌پرسد نان هم می‌خوری؟ و ماری می‌گوید Non." },
          { type: "mcq", prompt: "پل درباره پنیر چه می‌گوید؟", options: ["خیلی خوب است", "بد است", "کوچک است", "گران است"], correct: 0, explanation_fa: "پل می‌گوید Le fromage ici est très bon." },
        ],
      },
      reading: {
        A: [
          { type: "mcq", prompt: "ماری چه می‌نوشد؟", options: ["چای با شیر", "قهوه", "آب", "شیرقهوه"], correct: 0, explanation_fa: "ماری می‌گوید Je bois du thé avec du lait، یعنی چای با شیر." },
          { type: "find", prompt: "کدام جمله می‌گوید پنیر خوب است؟", correct_sentence: 7, explanation_fa: "پل می‌گوید Le fromage ici est très bon." },
          { type: "tf", prompt: "پل شیرقهوه می‌نوشد.", correct: true, explanation_fa: "پل می‌گوید Je bois un café au lait." },
        ],
        B: [
          {
            type: "match",
            prompt: "هر نفر را به چیزی که می‌نوشد وصل کن.",
            left: ["ماری", "پل"],
            right: ["چای با شیر", "شیرقهوه", "آب"],
            pairs: [
              [0, 0],
              [1, 1],
            ],
            explanation_fa: "ماری چای با شیر می‌نوشد و پل شیرقهوه. کسی آب نمی‌نوشد.",
          },
          { type: "tf", prompt: "ماری یک سیب می‌خورد.", correct: true, explanation_fa: "ماری می‌گوید je mange une pomme." },
          {
            type: "order",
            prompt: "این‌ها را به ترتیبی که در گفتگو آمده بچین.",
            items: ["پل حال ماری را می‌پرسد", "پل از نوشیدنی‌اش می‌گوید", "پل درباره نان می‌پرسد", "پل از پنیر تعریف می‌کند"],
            correct_order: [0, 1, 2, 3],
            explanation_fa: "گفتگو با سلام و احوال‌پرسی شروع می‌شود و با پنیر تمام می‌شود.",
          },
        ],
      },
    },
  },
  {
    code: "fr-a1-t002",
    title: "Le message de Hugo",
    kind: "voice_message",
    lines: [
      { text: "Bonjour Léa, c'est Hugo.", fa: "سلام لئا، هوگو هستم." },
      { text: "Je suis à Lyon avec mon frère.", fa: "با برادرم در لیون هستم." },
      { text: "Nous habitons dans une petite maison.", fa: "در یک خانه کوچک زندگی می‌کنیم." },
      { text: "Nous avons 2 chats et un chien.", fa: "دو گربه و یک سگ داریم." },
      { text: "La maison est dans une rue très belle.", fa: "خانه در یک خیابان خیلی زیباست." },
      { text: "Demain, nous allons à Paris avec la voiture de mon père.", fa: "فردا با ماشین پدرم به پاریس می‌رویم." },
      { text: "Le matin, je vais au travail.", fa: "صبح سر کار می‌روم." },
      { text: "À demain !", fa: "تا فردا!" },
    ],
    keyWords: ["habiter", "voiture"],
    sets: {
      listening: {
        A: [
          { type: "mcq", prompt: "هوگو الان کجاست؟", options: ["لیون", "پاریس", "مدرسه", "کافه"], correct: 0, explanation_fa: "هوگو می‌گوید Je suis à Lyon، یعنی در لیون هستم." },
          { type: "num", prompt: "هوگو چند گربه دارد؟ عددش را بنویس.", answer: "2", accepted: ["2", "deux"], explanation_fa: "در پیام می‌گوید Nous avons 2 chats." },
          { type: "tf", prompt: "هوگو و برادرش در خانه‌ای بزرگ زندگی می‌کنند.", correct: false, explanation_fa: "خانه‌شان une petite maison است، یعنی یک خانه کوچک." },
          { type: "dict", sentence: 6, explanation_fa: "جمله این بود: Le matin, je vais au travail." },
        ],
        B: [
          { type: "mcq", prompt: "فردا با چه به پاریس می‌روند؟", options: ["با ماشین پدرش", "با قطار", "پیاده", "با ماشین برادرش"], correct: 0, explanation_fa: "می‌گوید avec la voiture de mon père، یعنی با ماشین پدرم." },
          { type: "tf", prompt: "هوگو یک سگ هم دارد.", correct: true, explanation_fa: "می‌گوید 2 chats et un chien." },
          { type: "tf", prompt: "هوگو صبح به مدرسه می‌رود.", correct: false, explanation_fa: "می‌گوید je vais au travail، یعنی سر کار می‌روم." },
        ],
      },
      reading: {
        A: [
          { type: "mcq", prompt: "هوگو با چه کسی در لیون است؟", options: ["برادرش", "پدرش", "خواهرش", "دوستش"], correct: 0, explanation_fa: "می‌گوید avec mon frère، یعنی با برادرم." },
          { type: "find", prompt: "کدام جمله می‌گوید فردا کجا می‌روند؟", correct_sentence: 5, explanation_fa: "این جمله: Demain, nous allons à Paris…" },
          {
            type: "match",
            prompt: "هر حیوان را به تعدادش وصل کن.",
            left: ["گربه", "سگ"],
            right: ["دو", "یک", "سه"],
            pairs: [
              [0, 0],
              [1, 1],
            ],
            explanation_fa: "در پیام آمده 2 chats et un chien، یعنی دو گربه و یک سگ.",
          },
        ],
        B: [
          { type: "tf", prompt: "خانه در خیابانی زیباست.", correct: true, explanation_fa: "می‌گوید dans une rue très belle." },
          {
            type: "order",
            prompt: "این‌ها را به ترتیب پیام بچین.",
            items: ["هوگو می‌گوید کجاست", "از خانه و حیوان‌ها می‌گوید", "از سفر فردا می‌گوید", "خداحافظی می‌کند"],
            correct_order: [0, 1, 2, 3],
            explanation_fa: "پیام با سلام شروع می‌شود و با À demain تمام می‌شود.",
          },
          { type: "mcq", prompt: "هوگو صبح کجا می‌رود؟", options: ["سر کار", "مدرسه", "کافه", "خانه مادرش"], correct: 0, explanation_fa: "هوگو می‌گوید je vais au travail." },
        ],
      },
    },
  },
  {
    code: "fr-a1-t003",
    title: "La famille de Léa",
    kind: "dialogue",
    lines: [
      { speaker: "Hugo", text: "Léa, tu as un frère ?", fa: "لئا، برادر داری؟" },
      { speaker: "Léa", text: "Non, j'ai une sœur.", fa: "نه، یک خواهر دارم." },
      { speaker: "Hugo", text: "Elle est grande ?", fa: "بزرگ است؟" },
      { speaker: "Léa", text: "Non, elle est petite, elle va à l'école.", fa: "نه، کوچک است، به مدرسه می‌رود." },
      { speaker: "Hugo", text: "Et ton père ?", fa: "و پدرت؟" },
      { speaker: "Léa", text: "Mon père parle français et il aime les livres.", fa: "پدرم فرانسوی حرف می‌زند و کتاب دوست دارد." },
      { speaker: "Hugo", text: "Et ta mère ?", fa: "و مادرت؟" },
      { speaker: "Léa", text: "Ma mère habite à Paris avec un chat noir.", fa: "مادرم با یک گربه سیاه در پاریس زندگی می‌کند." },
    ],
    keyWords: ["sœur", "école"],
    sets: {
      listening: {
        A: [
          { type: "mcq", prompt: "لئا چه دارد؟", options: ["یک خواهر", "یک برادر", "دو خواهر", "یک سگ"], correct: 0, explanation_fa: "لئا می‌گوید Non, j'ai une sœur." },
          { type: "tf", prompt: "خواهر لئا کوچک است.", correct: true, explanation_fa: "لئا می‌گوید elle est petite." },
          {
            type: "order",
            prompt: "این‌ها را به ترتیبی که شنیدی بچین.",
            items: ["خواهر", "پدر", "مادر", "گربه"],
            correct_order: [0, 1, 2, 3],
            explanation_fa: "اول از خواهر می‌گوید، بعد پدر، بعد مادر و گربه‌اش.",
          },
        ],
        B: [
          { type: "mcq", prompt: "مادر لئا کجا زندگی می‌کند؟", options: ["پاریس", "لیون", "مدرسه", "خانه لئا"], correct: 0, explanation_fa: "لئا می‌گوید Ma mère habite à Paris." },
          { type: "tf", prompt: "پدر لئا کتاب دوست دارد.", correct: true, explanation_fa: "لئا می‌گوید il aime les livres." },
          { type: "dict", sentence: 1, explanation_fa: "جمله این بود: Non, j'ai une sœur." },
        ],
      },
      reading: {
        A: [
          { type: "mcq", prompt: "گربه مادر لئا چه رنگی است؟", options: ["سیاه", "سفید", "قرمز", "آبی"], correct: 0, explanation_fa: "مادرش un chat noir دارد، یعنی یک گربه سیاه." },
          { type: "find", prompt: "کدام جمله می‌گوید خواهر لئا به مدرسه می‌رود؟", correct_sentence: 3, explanation_fa: "لئا می‌گوید elle va à l'école." },
          { type: "tf", prompt: "لئا برادر دارد.", correct: false, explanation_fa: "لئا می‌گوید Non, j'ai une sœur." },
        ],
        B: [
          {
            type: "match",
            prompt: "هر نفر را به چیزی که درباره‌اش گفته شده وصل کن.",
            left: ["خواهر", "پدر", "مادر"],
            right: ["به مدرسه می‌رود", "کتاب دوست دارد", "در پاریس زندگی می‌کند", "سگ دارد"],
            pairs: [
              [0, 0],
              [1, 1],
              [2, 2],
            ],
            explanation_fa: "خواهر به مدرسه می‌رود، پدر کتاب دوست دارد و مادر در پاریس است. سگی در متن نیست.",
          },
          { type: "tf", prompt: "پدر لئا فرانسوی حرف می‌زند.", correct: true, explanation_fa: "لئا می‌گوید Mon père parle français." },
          { type: "mcq", prompt: "خواهر لئا چطور است؟", options: ["کوچک", "بزرگ", "زیبا", "نو"], correct: 0, explanation_fa: "لئا می‌گوید elle est petite." },
        ],
      },
    },
  },
  {
    code: "fr-a1-t004",
    title: "Le menu du café",
    kind: "menu",
    lines: [
      { text: "Bonjour, ici le café de Marie.", fa: "سلام، این‌جا کافه ماری است." },
      { text: "Le matin, nous avons du café, du thé et du lait.", fa: "صبح قهوه، چای و شیر داریم." },
      { text: "Le café au lait est très bon.", fa: "شیرقهوه خیلی خوب است." },
      { text: "Nous avons aussi du pain avec du fromage.", fa: "نان با پنیر هم داریم." },
      { text: "Les pommes sont rouges et vertes.", fa: "سیب‌ها قرمز و سبزند." },
      { text: "Le soir, vous mangez ici ?", fa: "عصر این‌جا غذا می‌خورید؟" },
      { text: "Le soir, nous avons 3 tables dans la rue.", fa: "عصر سه میز در خیابان داریم." },
      { text: "Merci et à demain !", fa: "ممنون و تا فردا!" },
    ],
    keyWords: ["thé", "table"],
    sets: {
      listening: {
        A: [
          { type: "mcq", prompt: "صبح در کافه چه چیزی هست؟", options: ["قهوه، چای و شیر", "فقط آب", "فقط قهوه", "پنیر و سیب"], correct: 0, explanation_fa: "می‌گوید du café, du thé et du lait." },
          { type: "num", prompt: "عصر چند میز در خیابان هست؟ عددش را بنویس.", answer: "3", accepted: ["3", "trois"], explanation_fa: "می‌گوید nous avons 3 tables dans la rue." },
          { type: "tf", prompt: "شیرقهوه کافه خوب نیست.", correct: false, explanation_fa: "می‌گوید Le café au lait est très bon." },
          { type: "dict", sentence: 3, explanation_fa: "جمله این بود: Nous avons aussi du pain avec du fromage." },
        ],
        B: [
          { type: "mcq", prompt: "کافه مال کیست؟", options: ["ماری", "پل", "لئا", "هوگو"], correct: 0, explanation_fa: "اول می‌گوید ici le café de Marie." },
          { type: "tf", prompt: "سیب‌ها قرمز و سبزند.", correct: true, explanation_fa: "می‌گوید Les pommes sont rouges et vertes." },
          {
            type: "order",
            prompt: "این‌ها را به ترتیبی که شنیدی بچین.",
            items: ["نوشیدنی‌های صبح", "نان و پنیر", "سیب‌ها", "میزهای عصر"],
            correct_order: [0, 1, 2, 3],
            explanation_fa: "اول از نوشیدنی‌ها می‌گوید، بعد نان و پنیر، بعد سیب و آخر میزهای عصر.",
          },
        ],
      },
      reading: {
        A: [
          { type: "mcq", prompt: "نان را با چه می‌دهند؟", options: ["پنیر", "شیر", "سیب", "چای"], correct: 0, explanation_fa: "نوشته du pain avec du fromage." },
          { type: "find", prompt: "کدام جمله درباره میزهای عصر است؟", correct_sentence: 6, explanation_fa: "این جمله: Le soir, nous avons 3 tables dans la rue." },
          { type: "tf", prompt: "کافه صبح چای ندارد.", correct: false, explanation_fa: "نوشته du thé، یعنی چای دارد." },
        ],
        B: [
          {
            type: "match",
            prompt: "هر چیز را به چیزی که درباره‌اش نوشته وصل کن.",
            left: ["شیرقهوه", "سیب‌ها", "میزها"],
            right: ["خیلی خوب است", "قرمز و سبزند", "در خیابان‌اند", "بزرگ‌اند"],
            pairs: [
              [0, 0],
              [1, 1],
              [2, 2],
            ],
            explanation_fa: "شیرقهوه خیلی خوب است، سیب‌ها قرمز و سبزند و میزها عصر در خیابان‌اند.",
          },
          { type: "mcq", prompt: "آخر منو چه نوشته؟", options: ["ممنون و تا فردا", "سلام", "شب بخیر", "بفرمایید"], correct: 0, explanation_fa: "آخرش نوشته Merci et à demain." },
        ],
      },
    },
  },
  {
    code: "fr-a1-t005",
    title: "Le nouveau chien de Paul",
    kind: "dialogue",
    lines: [
      { speaker: "Léa", text: "Paul, tu as un chien maintenant ?", fa: "پل، حالا سگ داری؟" },
      { speaker: "Paul", text: "Oui, j'ai un nouveau chien.", fa: "آره، یک سگ تازه دارم." },
      { speaker: "Léa", text: "Il est grand ?", fa: "بزرگ است؟" },
      { speaker: "Paul", text: "Non, il est petit et blanc.", fa: "نه، کوچک و سفید است." },
      { speaker: "Léa", text: "Il mange du fromage ?", fa: "پنیر می‌خورد؟" },
      { speaker: "Paul", text: "Non, il mange du pain et il boit de l'eau.", fa: "نه، نان می‌خورد و آب می‌نوشد." },
      { speaker: "Léa", text: "Et ton chat ?", fa: "و گربه‌ات؟" },
      { speaker: "Paul", text: "Mon chat noir n'aime pas le chien !", fa: "گربه سیاهم سگ را دوست ندارد!" },
    ],
    keyWords: ["nouveau", "blanc"],
    sets: {
      listening: {
        A: [
          { type: "mcq", prompt: "سگ پل چطور است؟", options: ["کوچک و سفید", "بزرگ و سیاه", "کوچک و سیاه", "بزرگ و سفید"], correct: 0, explanation_fa: "پل می‌گوید il est petit et blanc." },
          { type: "tf", prompt: "سگ پل پنیر می‌خورد.", correct: false, explanation_fa: "پل می‌گوید Non, il mange du pain." },
          { type: "dict", sentence: 3, explanation_fa: "جمله این بود: Non, il est petit et blanc." },
        ],
        B: [
          { type: "mcq", prompt: "سگ چه می‌نوشد؟", options: ["آب", "شیر", "چای", "قهوه"], correct: 0, explanation_fa: "پل می‌گوید il boit de l'eau." },
          { type: "tf", prompt: "گربه پل سگ را دوست دارد.", correct: false, explanation_fa: "پل می‌گوید Mon chat noir n'aime pas le chien." },
          {
            type: "order",
            prompt: "پرسش‌های لئا را به ترتیب بچین.",
            items: ["سگ داری؟", "بزرگ است؟", "پنیر می‌خورد؟", "و گربه‌ات؟"],
            correct_order: [0, 1, 2, 3],
            explanation_fa: "لئا اول درباره سگ می‌پرسد، بعد اندازه‌اش، بعد غذایش و آخر گربه.",
          },
        ],
      },
      reading: {
        A: [
          { type: "mcq", prompt: "گربه پل چه رنگی است؟", options: ["سیاه", "سفید", "قرمز", "سبز"], correct: 0, explanation_fa: "پل می‌گوید Mon chat noir." },
          { type: "find", prompt: "کدام جمله می‌گوید سگ چه می‌خورد و می‌نوشد؟", correct_sentence: 5, explanation_fa: "این جمله: Non, il mange du pain et il boit de l'eau." },
          { type: "tf", prompt: "سگ پل تازه است.", correct: true, explanation_fa: "پل می‌گوید j'ai un nouveau chien." },
        ],
        B: [
          {
            type: "match",
            prompt: "هر حیوان را به چیزی که درباره‌اش گفته شده وصل کن.",
            left: ["سگ", "گربه"],
            right: ["کوچک و سفید است", "سگ را دوست ندارد", "به مدرسه می‌رود"],
            pairs: [
              [0, 0],
              [1, 1],
            ],
            explanation_fa: "سگ کوچک و سفید است و گربه سگ را دوست ندارد.",
          },
          { type: "tf", prompt: "لئا سگ دارد.", correct: false, explanation_fa: "در متن فقط پل سگ دارد؛ لئا فقط می‌پرسد." },
        ],
      },
    },
  },
  {
    code: "fr-a1-t006",
    title: "Le message de Marie",
    kind: "voice_message",
    lines: [
      { text: "Bonjour Paul, c'est Marie.", fa: "سلام پل، ماری هستم." },
      { text: "Je suis à Paris avec mon ami Hugo.", fa: "با دوستم هوگو در پاریس هستم." },
      { text: "Hugo parle très bien français.", fa: "هوگو خیلی خوب فرانسوی حرف می‌زند." },
      { text: "Il a 3 frères et une sœur.", fa: "سه برادر و یک خواهر دارد." },
      { text: "Ce soir, nous allons au café avec la sœur de Hugo.", fa: "امشب با خواهرش به کافه می‌رویم." },
      { text: "Demain matin, je vais à l'école.", fa: "فردا صبح به مدرسه می‌روم." },
      { text: "Tu vas bien ?", fa: "حالت خوب است؟" },
      { text: "À demain soir !", fa: "تا فردا شب!" },
    ],
    keyWords: ["soir", "ami"],
    sets: {
      listening: {
        A: [
          { type: "mcq", prompt: "ماری با چه کسی در پاریس است؟", options: ["دوستش هوگو", "برادرش", "پل", "مادرش"], correct: 0, explanation_fa: "ماری می‌گوید avec mon ami Hugo." },
          { type: "num", prompt: "هوگو چند برادر دارد؟ عددش را بنویس.", answer: "3", accepted: ["3", "trois"], explanation_fa: "ماری می‌گوید Il a 3 frères." },
          { type: "tf", prompt: "ماری فردا صبح به مدرسه می‌رود.", correct: true, explanation_fa: "ماری می‌گوید Demain matin, je vais à l'école." },
        ],
        B: [
          { type: "mcq", prompt: "امشب کجا می‌روند؟", options: ["کافه", "مدرسه", "لیون", "خانه پل"], correct: 0, explanation_fa: "ماری می‌گوید nous allons au café." },
          { type: "tf", prompt: "هوگو فرانسوی را بد حرف می‌زند.", correct: false, explanation_fa: "ماری می‌گوید Hugo parle très bien français." },
          { type: "dict", sentence: 2, explanation_fa: "جمله این بود: Hugo parle très bien français." },
        ],
      },
      reading: {
        A: [
          { type: "mcq", prompt: "امشب چه کسی هم با آن‌ها به کافه می‌آید؟", options: ["خواهر هوگو", "پدر ماری", "پل", "برادر پل"], correct: 0, explanation_fa: "نوشته nous allons au café avec sa sœur." },
          { type: "find", prompt: "کدام جمله می‌گوید ماری کجاست؟", correct_sentence: 1, explanation_fa: "این جمله: Je suis à Paris avec mon ami Hugo." },
          { type: "tf", prompt: "هوگو یک خواهر دارد.", correct: true, explanation_fa: "نوشته Il a 3 frères et une sœur." },
        ],
        B: [
          {
            type: "order",
            prompt: "این‌ها را به ترتیب پیام بچین.",
            items: ["ماری می‌گوید کجاست", "از برادرهای هوگو می‌گوید", "از کافه امشب می‌گوید", "خداحافظی می‌کند"],
            correct_order: [0, 1, 2, 3],
            explanation_fa: "پیام با سلام و جای ماری شروع می‌شود و با À demain soir تمام می‌شود.",
          },
          { type: "mcq", prompt: "پیام برای کیست؟", options: ["پل", "هوگو", "لئا", "مادر ماری"], correct: 0, explanation_fa: "اولش نوشته Bonjour Paul." },
        ],
      },
    },
  },
  {
    code: "fr-a1-t007",
    title: "Une maison à Lyon",
    kind: "ad",
    lines: [
      { text: "Nous avons une maison à Lyon.", fa: "ما یک خانه در لیون داریم." },
      { text: "La maison est grande et très belle.", fa: "خانه بزرگ و خیلی زیباست." },
      { text: "Elle est dans une petite rue.", fa: "در یک خیابان کوچک است." },
      { text: "La maison a 2 tables et des livres.", fa: "خانه دو میز و چند کتاب دارد." },
      { text: "Un chat noir habite aussi ici.", fa: "یک گربه سیاه هم این‌جا زندگی می‌کند." },
      { text: "Vous aimez les chats ?", fa: "گربه دوست دارید؟" },
      { text: "Vous allez aimer la maison !", fa: "خانه را دوست خواهید داشت!" },
    ],
    keyWords: ["maison", "rue"],
    sets: {
      listening: {
        A: [
          { type: "mcq", prompt: "خانه کجاست؟", options: ["لیون", "پاریس", "کنار مدرسه", "کنار کافه"], correct: 0, explanation_fa: "می‌گوید une maison à Lyon." },
          { type: "num", prompt: "خانه چند میز دارد؟ عددش را بنویس.", answer: "2", accepted: ["2", "deux"], explanation_fa: "می‌گوید La maison a 2 tables." },
          { type: "tf", prompt: "خانه کوچک است.", correct: false, explanation_fa: "می‌گوید La maison est grande؛ فقط خیابانش کوچک است." },
        ],
        B: [
          { type: "mcq", prompt: "چه حیوانی در خانه زندگی می‌کند؟", options: ["گربه سیاه", "سگ سفید", "گربه سفید", "سگ سیاه"], correct: 0, explanation_fa: "می‌گوید Un chat noir habite aussi ici." },
          { type: "tf", prompt: "خانه در یک خیابان کوچک است.", correct: true, explanation_fa: "می‌گوید Elle est dans une petite rue." },
          { type: "dict", sentence: 1, explanation_fa: "جمله این بود: La maison est grande et très belle." },
        ],
      },
      reading: {
        A: [
          { type: "mcq", prompt: "این آگهی درباره چیست؟", options: ["یک خانه", "یک ماشین", "یک کافه", "یک مدرسه"], correct: 0, explanation_fa: "آگهی از une maison à Lyon می‌گوید." },
          { type: "find", prompt: "کدام جمله می‌گوید خانه زیباست؟", correct_sentence: 1, explanation_fa: "این جمله: La maison est grande et très belle." },
          {
            type: "match",
            prompt: "هر چیز را به چیزی که درباره‌اش نوشته وصل کن.",
            left: ["خانه", "خیابان", "گربه"],
            right: ["بزرگ و زیباست", "کوچک است", "سیاه است", "قرمز است"],
            pairs: [
              [0, 0],
              [1, 1],
              [2, 2],
            ],
            explanation_fa: "خانه بزرگ و زیباست، خیابان کوچک است و گربه سیاه است.",
          },
        ],
        B: [
          { type: "tf", prompt: "در خانه کتاب هست.", correct: true, explanation_fa: "نوشته des livres." },
          {
            type: "order",
            prompt: "این‌ها را به ترتیب آگهی بچین.",
            items: ["جای خانه", "خانه چطور است", "میزها و کتاب‌ها", "گربه"],
            correct_order: [0, 1, 2, 3],
            explanation_fa: "آگهی اول جای خانه را می‌گوید، بعد ظاهرش، بعد میز و کتاب و آخر گربه.",
          },
        ],
      },
    },
  },
];
