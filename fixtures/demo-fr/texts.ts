/**
 * Three A1 texts of the French demo (DECISIONS.md, «محتوای نمونه فرانسوی»), band 1, written by hand
 * with the demo's own words only. Each has the four question sets of PRD §14.6, so a tester meets
 * it in either track. Questions of band 1 are in Persian (PRD §7.3).
 */

export type DemoLine = { text: string; fa: string; speaker?: string; meanings?: Record<string, string> };
export type DemoText = {
  code: string;
  title: string;
  kind: "dialogue" | "voice_message";
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
];
