/**
 * Speaking and writing of the French demo (PRD §8b, DECISIONS.md «محتوای نمونه فرانسوی»), written by
 * hand with the demo's own words. Two A1 situational dialogues (P-D), two find-the-mistake texts and
 * two guided writing tasks. PRD §8b.7 makes those last two B1 and B2 content, so they are stored as B1:
 * a tester tries them from their item page in the panel («دید زبان‌آموز») and the writing tasks from
 * «آزمایش مثل زبان‌آموز»; the demo's A1 learner never reaches B1 in a session.
 */

export type DemoTurn = {
  speaker: string | null;
  line: [text: string, fa: string];
  /** Three answers; `correct` is the right one. */
  choices: [text: string, fa: string][];
  correct: number;
  why: string;
};
export type DemoDialogue = { code: string; title: string; situation: string; turns: DemoTurn[] };

export const demoDialogues: DemoDialogue[] = [
  {
    code: "fr-a1-d001",
    title: "سفارش در کافه",
    situation: "در یک کافه در پاریس نشسته‌ای و پیشخدمت پیشت می‌آید.",
    turns: [
      {
        speaker: "Paul",
        line: ["Bonjour, vous allez bien ?", "سلام، حالتان خوب است؟"],
        choices: [
          ["Oui, très bien, merci.", "بله، خیلی خوب، ممنون."],
          ["Non, je suis Paul.", "نه، من پل هستم."],
          ["Je mange une pomme.", "من یک سیب می‌خورم."],
        ],
        correct: 0,
        why: "به «حالتان خوب است؟» جواب می‌دهیم که حالمان خوب است و تشکر می‌کنیم.",
      },
      {
        speaker: "Paul",
        line: ["Vous aimez le café ?", "قهوه دوست دارید؟"],
        choices: [
          ["Oui, c'est une voiture.", "بله، این یک ماشین است."],
          ["Non, je bois du thé.", "نه، من چای می‌نوشم."],
          ["Je suis à la maison.", "من در خانه هستم."],
        ],
        correct: 1,
        why: "سؤال درباره قهوه است؛ جواب درست می‌گوید قهوه نه، چای می‌نوشیم.",
      },
      {
        speaker: "Paul",
        line: ["Avec du lait ?", "با شیر؟"],
        choices: [
          ["Oui, j'habite à Paris.", "بله، من در پاریس زندگی می‌کنم."],
          ["Non, c'est un chien.", "نه، این یک سگ است."],
          ["Oui, avec du lait, merci.", "بله، با شیر، ممنون."],
        ],
        correct: 2,
        why: "پیشخدمت می‌پرسد چای را با شیر می‌خواهیم یا نه؛ فقط این جواب به همین سؤال است.",
      },
      {
        speaker: "Paul",
        line: ["Vous mangez aussi ?", "چیزی هم می‌خورید؟"],
        choices: [
          ["Oui, du pain et du fromage.", "بله، نان و پنیر."],
          ["Non, je parle français.", "نه، من فرانسوی حرف می‌زنم."],
          ["Oui, il est grand.", "بله، او قدبلند است."],
        ],
        correct: 0,
        why: "سؤال درباره خوردن است؛ جواب درست می‌گوید چه می‌خوریم.",
      },
      {
        speaker: "Paul",
        line: ["Le fromage est très bon ici.", "پنیر اینجا خیلی خوب است."],
        choices: [
          ["Non, je suis une fille.", "نه، من یک دختر هستم."],
          ["Oui, j'aime le fromage.", "بله، من پنیر دوست دارم."],
          ["Oui, la rue est petite.", "بله، خیابان کوچک است."],
        ],
        correct: 1,
        why: "پیشخدمت از پنیر تعریف می‌کند؛ جواب طبیعی این است که ما هم پنیر دوست داریم.",
      },
    ],
  },
  {
    code: "fr-a1-d002",
    title: "آشنایی با همسایه",
    situation: "جلوی خانه‌ات با یک همسایه تازه آشنا می‌شوی.",
    turns: [
      {
        speaker: "Marie",
        line: ["Bonjour, je suis Marie.", "سلام، من ماری هستم."],
        choices: [
          ["Merci, je bois de l'eau.", "ممنون، من آب می‌نوشم."],
          ["Bonjour Marie, je suis Paul.", "سلام ماری، من پل هستم."],
          ["Non, c'est un livre.", "نه، این یک کتاب است."],
        ],
        correct: 1,
        why: "ماری خودش را معرفی کرد؛ ما هم سلام می‌کنیم و خودمان را معرفی می‌کنیم.",
      },
      {
        speaker: "Marie",
        line: ["Tu habites ici ?", "تو اینجا زندگی می‌کنی؟"],
        choices: [
          ["Oui, j'habite ici avec ma famille.", "بله، من با خانواده‌ام اینجا زندگی می‌کنم."],
          ["Non, je mange du pain.", "نه، من نان می‌خورم."],
          ["Oui, c'est un chat.", "بله، این یک گربه است."],
        ],
        correct: 0,
        why: "سؤال درباره جای زندگی است؛ جواب درست با habiter جواب می‌دهد.",
      },
      {
        speaker: "Marie",
        line: ["Tu as un chien ?", "سگ داری؟"],
        choices: [
          ["Oui, je vais bien.", "بله، حالم خوب است."],
          ["Non, je parle français.", "نه، من فرانسوی حرف می‌زنم."],
          ["Non, j'ai un chat.", "نه، من یک گربه دارم."],
        ],
        correct: 2,
        why: "به «سگ داری؟» با avoir جواب می‌دهیم: سگ نه، ولی یک گربه داریم.",
      },
      {
        speaker: "Marie",
        line: ["Il est petit ou grand ?", "کوچک است یا بزرگ؟"],
        choices: [
          ["Il est petit et noir.", "کوچک و سیاه است."],
          ["Elle est à l'école.", "او در مدرسه است."],
          ["Oui, merci.", "بله، ممنون."],
        ],
        correct: 0,
        why: "سؤال «کوچک یا بزرگ» است؛ پس یکی از این دو را می‌گوییم. گربه (chat) مذکر است، پس il و petit.",
      },
      {
        speaker: "Marie",
        line: ["À demain, Paul !", "تا فردا، پل!"],
        choices: [
          ["Je bois un café au lait.", "من یک شیرقهوه می‌نوشم."],
          ["À demain, Marie !", "تا فردا، ماری!"],
          ["Oui, c'est ma voiture.", "بله، این ماشین من است."],
        ],
        correct: 1,
        why: "در خداحافظی همان را برمی‌گردانیم: À demain!",
      },
    ],
  },
];

/** Find the mistake: `{{wrong|right}}` marks the mistakes, one explanation each in order. */
export type DemoErrorfix = { marked: string; fa: string; units: string[]; why: string[] };

export const demoErrorfix: DemoErrorfix[] = [
  {
    marked: "Ma sœur est {{grand|grande}} et elle {{est|a}} un chat {{noire|noir}}.",
    fa: "خواهرم قدبلند است و یک گربه سیاه دارد.",
    units: ["fr-a1-avoir", "fr-a1-un-une"],
    why: [
      "sœur مؤنث است، پس صفتش هم مؤنث می‌شود: grande.",
      "برای «داشتن» فعل avoir به کار می‌رود، نه être: elle a.",
      "chat مذکر است، پس صفتش مذکر می‌ماند: noir.",
    ],
  },
  {
    marked: "Nous {{allez|allons}} à l'école et nous {{mange|mangeons}} du pain.",
    fa: "ما به مدرسه می‌رویم و نان می‌خوریم.",
    units: ["fr-a1-aller", "fr-a1-er"],
    why: ["با nous، فعل aller می‌شود allons.", "با nous، فعل manger می‌شود mangeons (با یک e پیش از ons)."],
  },
];

export type DemoWriting = {
  prompt: string;
  min: number;
  max: number;
  checklist: string[];
  phrases: [text: string, fa: string][];
  model: string;
  modelFa: string;
};

export const demoWriting: DemoWriting[] = [
  {
    prompt: "خودت و خانواده‌ات را معرفی کن: کجا زندگی می‌کنی، با چه کسانی، و چه چیزهایی دوست داری.",
    min: 60,
    max: 120,
    checklist: ["گفتم کجا زندگی می‌کنم.", "دست‌کم دو نفر از خانواده‌ام را معرفی کردم.", "صفت‌ها را با اسمشان جور کردم (مذکر و مؤنث).", "گفتم چه چیزی دوست دارم."],
    phrases: [
      ["J'habite à…", "من در … زندگی می‌کنم"],
      ["avec ma famille", "با خانواده‌ام"],
      ["J'ai un frère et une sœur.", "من یک برادر و یک خواهر دارم."],
      ["Ma mère est…", "مادرم … است"],
      ["J'aime…", "من … دوست دارم"],
    ],
    model:
      "Bonjour ! Je m'appelle Paul et j'ai vingt-cinq ans. J'habite à Lyon avec ma famille, dans une petite maison près de l'école. Mon père travaille dans un café et ma mère est professeur. J'ai aussi une sœur, Léa, et un frère, Hugo. Léa a un chat noir et Hugo a un grand chien blanc. Le soir, nous mangeons ensemble et nous parlons beaucoup. J'aime ma famille et j'aime ma ville !",
    modelFa:
      "سلام! اسم من پل است و بیست‌وپنج سال دارم. با خانواده‌ام در لیون زندگی می‌کنم، در یک خانه کوچک نزدیک مدرسه. پدرم در یک کافه کار می‌کند و مادرم معلم است. یک خواهر به اسم لئا و یک برادر به اسم هوگو هم دارم. لئا یک گربه سیاه دارد و هوگو یک سگ بزرگ سفید. عصرها با هم غذا می‌خوریم و زیاد حرف می‌زنیم. خانواده‌ام را دوست دارم و شهرم را دوست دارم!",
  },
  {
    prompt: "یک روز معمولی‌ات را بنویس: صبح چه می‌خوری، کجا می‌روی و عصر چه کار می‌کنی.",
    min: 60,
    max: 120,
    checklist: ["صبح، ظهر و عصر را گفتم.", "فعل‌ها را با فاعلشان صرف کردم.", "دست‌کم یک جمله با nous نوشتم.", "از کلمه‌های زمان مثل le matin و le soir استفاده کردم."],
    phrases: [
      ["Le matin, je bois…", "صبح‌ها … می‌نوشم"],
      ["Je vais au travail en voiture.", "با ماشین سر کار می‌روم."],
      ["À midi, je mange…", "ظهر … می‌خورم"],
      ["Le soir, nous…", "عصرها ما …"],
      ["Bonne nuit !", "شب بخیر!"],
    ],
    model:
      "Le matin, je bois un café au lait et je mange du pain avec du fromage. Ensuite, je vais au travail en voiture. Mon travail est dans une grande rue de Paris. À midi, je mange avec mes amis dans un petit restaurant. Le soir, je rentre à la maison. Je parle avec ma femme, nous regardons un film et nous buvons du thé. À onze heures, je dis « bonne nuit » et je dors.",
    modelFa:
      "صبح‌ها یک شیرقهوه می‌نوشم و نان و پنیر می‌خورم. بعد با ماشین سر کار می‌روم. محل کارم در یک خیابان بزرگ پاریس است. ظهر با دوستانم در یک رستوران کوچک غذا می‌خورم. عصر به خانه برمی‌گردم. با همسرم حرف می‌زنم، با هم فیلم می‌بینیم و چای می‌نوشیم. ساعت یازده «شب بخیر» می‌گویم و می‌خوابم.",
  },
];
