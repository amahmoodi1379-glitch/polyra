/**
 * The six grammar units of the French demo, in teaching order (PRD §6, §14.6). Targets are written
 * with {{blanks}}; the accepted answer is the text inside the braces. A target with two blanks gives
 * a distractor list per blank.
 */

export type GrammarTargetDef = { text: string; fa: string; distractors: string[] | [string[], string[]]; hint?: string; meanings?: Record<string, string> };
export type ExampleDef = { text: string; fa: string; meanings?: Record<string, string> };

export type UnitDef = {
  code: string;
  title: string;
  scope: string;
  canDo: string;
  lesson: string;
  table: string[][];
  examples: ExampleDef[];
  rule: string;
  mistake: string;
  sets?: { name: string; items: string[] }[];
  targets: GrammarTargetDef[];
  transforms: { instruction: string; source: string; outputs: string[] }[];
  translations: { fa: string; outputs: string[]; meanings?: Record<string, string> }[];
};

const NOT_UN = ["une", "des", "la"];
const NOT_UNE = ["un", "des", "le"];
const NEG = ["n'", "non", "pas"];
const PAS = ["non", "oui", "très"];

export const units: UnitDef[] = [
  {
    code: "fr-a1-un-une",
    title: "un و une: «یک» مذکر و مؤنث",
    scope: "un و une پیش از اسم مفرد؛ جنسیت اسم",
    canDo: "حالا می‌توانی با un و une درست بگویی چیزی «یک» چیست.",
    lesson:
      "در فرانسوی هر اسم یا مذکر است یا مؤنث، حتی میز و کتاب. برای «یک» دو کلمه هست: un پیش از اسم مذکر (un garçon، un livre) و une پیش از اسم مؤنث (une fille، une maison). جنسیت را همیشه نمی‌شود از معنی حدس زد: table مؤنث است و livre مذکر. پس هر اسم را همراه un یا une‌اش یاد بگیر، نه تنها.",
    table: [
      ["", "مذکر", "مؤنث"],
      ["یک", "un", "une"],
      ["مثال", "un chat", "une table"],
      ["مثال", "un garçon", "une fille"],
    ],
    examples: [
      { text: "C'est un garçon.", fa: "این یک پسر است." },
      { text: "C'est une fille.", fa: "این یک دختر است." },
      { text: "J'ai un livre et une pomme.", fa: "من یک کتاب و یک سیب دارم." },
    ],
    rule: "اسم مذکر: un. اسم مؤنث: une.",
    mistake: "فارسی جنسیت دستوری ندارد؛ برای همین فارسی‌زبان‌ها همه‌جا un می‌گذارند: un maison. درستش une maison است.",
    sets: [
      { name: "un", items: ["garçon", "homme", "livre", "chat", "chien", "ami"] },
      { name: "une", items: ["fille", "femme", "maison", "table", "école", "pomme"] },
    ],
    targets: [
      { text: "C'est {{un}} homme.", fa: "این یک مرد است.", distractors: NOT_UN, hint: "(یک)" },
      { text: "Marie est {{une}} femme.", fa: "ماری یک زن است.", distractors: NOT_UNE, hint: "(یک)" },
      { text: "Hugo est {{un}} garçon.", fa: "هوگو یک پسر است.", distractors: NOT_UN, hint: "(یک)" },
      { text: "Léa est {{une}} fille.", fa: "لئا یک دختر است.", distractors: NOT_UNE, hint: "(یک)" },
      { text: "J'ai {{un}} chat.", fa: "من یک گربه دارم.", distractors: NOT_UN, hint: "(یک)" },
      { text: "Paul a {{une}} maison.", fa: "پل یک خانه دارد.", distractors: NOT_UNE, hint: "(یک)" },
      { text: "C'est {{une}} école.", fa: "این یک مدرسه است.", distractors: NOT_UNE, hint: "(یک)" },
      { text: "Tu as {{une}} table ?", fa: "تو یک میز داری؟", distractors: NOT_UNE, hint: "(یک)" },
      { text: "C'est {{un}} ami.", fa: "این یک دوست است.", distractors: NOT_UN, hint: "(یک)" },
      { text: "J'ai {{un}} livre et {{une}} pomme.", fa: "من یک کتاب و یک سیب دارم.", distractors: [NOT_UN, NOT_UNE] },
      { text: "C'est {{un}} chien ou {{une}} pomme ?", fa: "این یک سگ است یا یک سیب؟", distractors: [NOT_UN, NOT_UNE] },
    ],
    transforms: [
      { instruction: "به‌جای garçon بنویس fille.", source: "C'est un garçon.", outputs: ["C'est une fille."] },
      { instruction: "به‌جای chat بنویس maison.", source: "J'ai un chat.", outputs: ["J'ai une maison."] },
      { instruction: "به‌جای femme بنویس homme.", source: "C'est une femme.", outputs: ["C'est un homme."] },
    ],
    translations: [
      { fa: "این یک کتاب است.", outputs: ["C'est un livre."] },
      { fa: "من یک گربه دارم.", outputs: ["J'ai un chat."] },
      { fa: "لئا یک دختر است.", outputs: ["Léa est une fille."] },
    ],
  },
  {
    code: "fr-a1-etre",
    title: "être: بودن",
    scope: "زمان حال être با شش ضمیر؛ c'est",
    canDo: "حالا می‌توانی خودت و دیگران را معرفی کنی.",
    lesson:
      "être یعنی «بودن» و پرکاربردترین فعل فرانسوی است. با هر ضمیر شکل جدایی دارد و قاعده ندارد، پس باید حفظ شود: je suis، tu es، il یا elle est، nous sommes، vous êtes، ils یا elles sont. برخلاف فارسی، فعل آخر جمله نمی‌آید و درست بعد از فاعل می‌نشیند: Je suis Marie یعنی «من ماری هستم». c'est (ce و est) یعنی «این … است».",
    table: [
      ["ضمیر", "être", "معنی"],
      ["je", "suis", "هستم"],
      ["tu", "es", "هستی"],
      ["il / elle", "est", "است"],
      ["nous", "sommes", "هستیم"],
      ["vous", "êtes", "هستید"],
      ["ils / elles", "sont", "هستند"],
    ],
    examples: [
      { text: "Je suis Marie.", fa: "من ماری هستم." },
      { text: "Vous êtes ici ?", fa: "شما اینجا هستید؟" },
      { text: "Ils sont amis.", fa: "آن‌ها با هم دوست‌اند." },
    ],
    rule: "être: suis، es، est، sommes، êtes، sont.",
    mistake: "فارسی‌زبان‌ها فعل را آخر جمله می‌گذارند: Je Marie suis. در فرانسوی فعل درست بعد از فاعل می‌آید: Je suis Marie.",
    targets: [
      { text: "Je {{suis}} ici.", fa: "من اینجا هستم.", distractors: ["es", "est", "sont"], hint: "(être)" },
      { text: "Tu {{es}} Paul ?", fa: "تو پل هستی؟", distractors: ["suis", "est", "êtes"], hint: "(être)" },
      { text: "Marie {{est}} une femme.", fa: "ماری یک زن است.", distractors: ["es", "sont", "suis"], hint: "(être)" },
      { text: "Nous {{sommes}} amis.", fa: "ما با هم دوستیم.", distractors: ["sont", "êtes", "est"], hint: "(être)" },
      { text: "Vous {{êtes}} ici ?", fa: "شما اینجا هستید؟", distractors: ["es", "sommes", "sont"], hint: "(être)" },
      { text: "Ils {{sont}} grands.", fa: "آن‌ها قدبلندند.", distractors: ["est", "sommes", "êtes"], hint: "(être)", meanings: { grands: "قدبلند" } },
      { text: "Elle {{est}} petite.", fa: "او کوچک است.", distractors: ["es", "sont", "suis"], hint: "(être)" },
      { text: "Le chat {{est}} sur la table.", fa: "گربه روی میز است.", distractors: ["es", "sont", "suis"], hint: "(être)" },
      { text: "Hugo et Léa {{sont}} ici.", fa: "هوگو و لئا اینجا هستند.", distractors: ["est", "sommes", "êtes"], hint: "(être)" },
      { text: "Elles {{sont}} à l'école.", fa: "آن‌ها در مدرسه هستند.", distractors: ["est", "sommes", "êtes"], hint: "(être)", meanings: { à: "در" } },
      {
        text: "Je {{suis}} grand et tu {{es}} petit.",
        fa: "من قدبلندم و تو قدکوتاهی.",
        distractors: [
          ["es", "est", "sont"],
          ["suis", "est", "sont"],
        ],
        meanings: { grand: "قدبلند", petit: "قدکوتاه" },
      },
    ],
    transforms: [
      { instruction: "جمله را با nous بنویس.", source: "Je suis ici.", outputs: ["Nous sommes ici."] },
      { instruction: "جمله را با ils بنویس.", source: "Il est grand.", outputs: ["Ils sont grands."] },
      { instruction: "جمله را با tu بنویس.", source: "Je suis Paul.", outputs: ["Tu es Paul."] },
    ],
    translations: [
      { fa: "من اینجا هستم.", outputs: ["Je suis ici."] },
      { fa: "ما با هم دوستیم.", outputs: ["Nous sommes amis."] },
      { fa: "او (دختر) کوچک است.", outputs: ["Elle est petite."] },
    ],
  },
  {
    code: "fr-a1-avoir",
    title: "avoir: داشتن",
    scope: "زمان حال avoir؛ j' پیش از ai",
    canDo: "حالا می‌توانی بگویی چه چیزهایی داری.",
    lesson:
      "avoir یعنی «داشتن». شکل‌هایش این‌هاست: j'ai، tu as، il یا elle a، nous avons، vous avez، ils یا elles ont. چون ai با حرف صدادار شروع می‌شود، je کوتاه می‌شود و j' می‌شود: j'ai، نه je ai. مراقب a باش: a بدون علامت از avoir است و یعنی «دارد»؛ à با علامت یعنی «به» یا «در».",
    table: [
      ["ضمیر", "avoir", "معنی"],
      ["j'", "ai", "دارم"],
      ["tu", "as", "داری"],
      ["il / elle", "a", "دارد"],
      ["nous", "avons", "داریم"],
      ["vous", "avez", "دارید"],
      ["ils / elles", "ont", "دارند"],
    ],
    examples: [
      { text: "J'ai un chat.", fa: "من یک گربه دارم." },
      { text: "Tu as un chien ?", fa: "تو یک سگ داری؟" },
      { text: "Nous avons une maison.", fa: "ما یک خانه داریم." },
    ],
    rule: "avoir: ai، as، a، avons، avez، ont. je و ai می‌شود j'ai.",
    mistake: "je ai غلط است؛ پیش از ai همیشه j' می‌آید: j'ai. a (دارد) را هم با à (به) قاطی نکن.",
    targets: [
      { text: "J'{{ai}} un chien.", fa: "من یک سگ دارم.", distractors: ["as", "a", "ont"], hint: "(avoir)" },
      { text: "Tu {{as}} un livre ?", fa: "تو یک کتاب داری؟", distractors: ["ai", "a", "avez"], hint: "(avoir)" },
      { text: "Paul {{a}} une maison.", fa: "پل یک خانه دارد.", distractors: ["à", "ont", "as"], hint: "(avoir)" },
      { text: "Nous {{avons}} un chat.", fa: "ما یک گربه داریم.", distractors: ["avez", "ont", "a"], hint: "(avoir)" },
      { text: "Vous {{avez}} une table ?", fa: "شما یک میز دارید؟", distractors: ["avons", "as", "ont"], hint: "(avoir)" },
      { text: "Ils {{ont}} un chien.", fa: "آن‌ها یک سگ دارند.", distractors: ["a", "avons", "sont"], hint: "(avoir)" },
      { text: "Marie {{a}} une fille.", fa: "ماری یک دختر دارد.", distractors: ["à", "as", "est"], hint: "(avoir)" },
      { text: "Elles {{ont}} une petite maison.", fa: "آن‌ها یک خانهٔ کوچک دارند.", distractors: ["a", "avez", "sont"], hint: "(avoir)" },
      { text: "Léa {{a}} un petit livre.", fa: "لئا یک کتاب کوچک دارد.", distractors: ["à", "ont", "as"], hint: "(avoir)" },
      {
        text: "J'{{ai}} un chat et tu {{as}} un chien.",
        fa: "من یک گربه دارم و تو یک سگ داری.",
        distractors: [
          ["as", "a", "ont"],
          ["ai", "a", "avez"],
        ],
      },
    ],
    transforms: [
      { instruction: "جمله را با nous بنویس.", source: "J'ai un chat.", outputs: ["Nous avons un chat."] },
      { instruction: "جمله را با elle بنویس.", source: "J'ai une maison.", outputs: ["Elle a une maison."] },
      { instruction: "جمله را با ils بنویس.", source: "Il a un chien.", outputs: ["Ils ont un chien."] },
    ],
    translations: [
      { fa: "من یک سگ دارم.", outputs: ["J'ai un chien."] },
      { fa: "تو یک کتاب داری؟", outputs: ["Tu as un livre ?"] },
      { fa: "آن‌ها یک خانه دارند.", outputs: ["Ils ont une maison.", "Elles ont une maison."] },
    ],
  },
  {
    code: "fr-a1-er",
    title: "فعل‌های -er در زمان حال",
    scope: "فعل‌های منظم -er (parler، manger، aimer، habiter) در زمان حال",
    canDo: "حالا می‌توانی از کارهای هر روزت بگویی.",
    lesson:
      "بیشتر فعل‌های فرانسوی به -er ختم می‌شوند و همه یک الگو دارند. -er را بردار تا ریشه بماند (parler می‌شود parl) و پایانهٔ هر ضمیر را اضافه کن: je parle، tu parles، il یا elle parle، nous parlons، vous parlez، ils یا elles parlent. parle و parles و parlent یک‌جور خوانده می‌شوند، چون s و ent آخر صدا ندارند. پیش از حرف صدادار je می‌شود j': j'aime، j'habite. manger با nous یک e اضافه می‌گیرد: nous mangeons.",
    table: [
      ["ضمیر", "پایانه", "parler"],
      ["je", "-e", "parle"],
      ["tu", "-es", "parles"],
      ["il / elle", "-e", "parle"],
      ["nous", "-ons", "parlons"],
      ["vous", "-ez", "parlez"],
      ["ils / elles", "-ent", "parlent"],
    ],
    examples: [
      { text: "Je parle français.", fa: "من فرانسوی حرف می‌زنم.", meanings: { français: "فرانسوی" } },
      { text: "Nous mangeons du pain.", fa: "ما نان می‌خوریم." },
      { text: "Elles habitent à Paris.", fa: "آن‌ها در پاریس زندگی می‌کنند.", meanings: { à: "در" } },
    ],
    rule: "ریشه + e، es، e، ons، ez، ent.",
    mistake: "ent آخر ils parlent خوانده نمی‌شود؛ فارسی‌زبان‌ها گاهی می‌گویند «پارلَنت». parlent همان «پارل» خوانده می‌شود.",
    targets: [
      { text: "Je {{parle}} français.", fa: "من فرانسوی حرف می‌زنم.", distractors: ["parles", "parlons", "parlez"], hint: "(parler)", meanings: { français: "فرانسوی" } },
      { text: "Tu {{parles}} avec Marie ?", fa: "با ماری حرف می‌زنی؟", distractors: ["parle", "parlez", "parlons"], hint: "(parler)" },
      { text: "Nous {{mangeons}} du pain.", fa: "ما نان می‌خوریم.", distractors: ["mangons", "mangez", "mangent"], hint: "(manger)" },
      { text: "Vous {{parlez}} français ?", fa: "شما فرانسوی حرف می‌زنید؟", distractors: ["parlons", "parles", "parlent"], hint: "(parler)", meanings: { français: "فرانسوی" } },
      { text: "Ils {{aiment}} le café.", fa: "آن‌ها قهوه دوست دارند.", distractors: ["aime", "aimons", "aimez"], hint: "(aimer)" },
      { text: "J'{{habite}} à Paris.", fa: "من در پاریس زندگی می‌کنم.", distractors: ["habites", "habitons", "habitez"], hint: "(habiter)", meanings: { à: "در" } },
      { text: "Elle {{mange}} une pomme.", fa: "او یک سیب می‌خورد.", distractors: ["manges", "mangeons", "mangez"], hint: "(manger)" },
      { text: "Tu {{aimes}} le thé ?", fa: "چای دوست داری؟", distractors: ["aime", "aimez", "aiment"], hint: "(aimer)" },
      { text: "Paul et Léa {{habitent}} à Lyon.", fa: "پل و لئا در لیون زندگی می‌کنند.", distractors: ["habite", "habitons", "habitez"], hint: "(habiter)", meanings: { à: "در" } },
      { text: "Nous {{aimons}} Paris.", fa: "ما پاریس را دوست داریم.", distractors: ["aimez", "aiment", "aime"], hint: "(aimer)" },
      { text: "Vous {{habitez}} ici ?", fa: "شما اینجا زندگی می‌کنید؟", distractors: ["habitons", "habites", "habitent"], hint: "(habiter)" },
      {
        text: "Je {{mange}} du pain et tu {{manges}} une pomme.",
        fa: "من نان می‌خورم و تو یک سیب می‌خوری.",
        distractors: [
          ["manges", "mangeons", "mangez"],
          ["mange", "mangez", "mangent"],
        ],
      },
    ],
    transforms: [
      { instruction: "جمله را با nous بنویس.", source: "Je parle français.", outputs: ["Nous parlons français."] },
      { instruction: "جمله را با ils بنویس.", source: "Il mange du pain.", outputs: ["Ils mangent du pain."] },
      { instruction: "جمله را با vous بنویس.", source: "Tu habites à Paris.", outputs: ["Vous habitez à Paris."] },
    ],
    translations: [
      { fa: "من در پاریس زندگی می‌کنم.", outputs: ["J'habite à Paris."], meanings: { à: "در" } },
      { fa: "ما فرانسوی حرف می‌زنیم.", outputs: ["Nous parlons français."], meanings: { français: "فرانسوی" } },
      { fa: "او (زن) قهوه دوست دارد.", outputs: ["Elle aime le café."] },
    ],
  },
  {
    code: "fr-a1-negation",
    title: "منفی کردن با ne … pas",
    scope: "ne … pas دور فعل؛ n' پیش از حرف صدادار",
    canDo: "حالا می‌توانی بگویی چه کاری نمی‌کنی.",
    lesson:
      "برای منفی کردن، فعل را بین ne و pas بگذار: Je parle («حرف می‌زنم») می‌شود Je ne parle pas («حرف نمی‌زنم»). پیش از حرف صدادار ne کوتاه می‌شود و n' می‌شود: Je n'aime pas le thé، Il n'est pas ici. در فارسی فقط یک «نـ» به فعل می‌چسبد؛ در فرانسوی دو تکه لازم است و فعل وسط آن‌ها می‌نشیند.",
    table: [
      ["مثبت", "منفی"],
      ["Je parle.", "Je ne parle pas."],
      ["Elle mange.", "Elle ne mange pas."],
      ["Tu es ici.", "Tu n'es pas ici."],
      ["Il aime le thé.", "Il n'aime pas le thé."],
    ],
    examples: [
      { text: "Je ne parle pas français.", fa: "من فرانسوی حرف نمی‌زنم.", meanings: { français: "فرانسوی" } },
      { text: "Paul n'est pas ici.", fa: "پل اینجا نیست." },
      { text: "Je n'aime pas le café.", fa: "من قهوه دوست ندارم." },
    ],
    rule: "ne + فعل + pas. پیش از حرف صدادار: n' + فعل + pas.",
    mistake: "فارسی‌زبان‌ها pas را جا می‌اندازند یا آخر جمله می‌گذارند: Je ne parle français pas. pas درست بعد از فعل می‌آید: Je ne parle pas français.",
    targets: [
      { text: "Je ne parle {{pas}} français.", fa: "من فرانسوی حرف نمی‌زنم.", distractors: PAS, hint: "(منفی)", meanings: { français: "فرانسوی" } },
      { text: "Paul {{n'est}} pas ici.", fa: "پل اینجا نیست.", distractors: ["ne est", "est", "non est"], hint: "(منفی)" },
      { text: "Je {{n'aime}} pas le thé.", fa: "من چای دوست ندارم.", distractors: ["ne aime", "aime", "non aime"], hint: "(منفی)" },
      { text: "Tu {{ne}} manges pas ?", fa: "غذا نمی‌خوری؟", distractors: NEG, hint: "(منفی)" },
      { text: "Nous ne sommes {{pas}} à Paris.", fa: "ما در پاریس نیستیم.", distractors: PAS, hint: "(منفی)", meanings: { à: "در" } },
      { text: "Elle {{n'habite}} pas ici.", fa: "او اینجا زندگی نمی‌کند.", distractors: ["ne habite", "habite", "non habite"], hint: "(منفی)" },
      { text: "Je {{ne}} suis pas Marie.", fa: "من ماری نیستم.", distractors: NEG, hint: "(منفی)" },
      { text: "Ils ne parlent {{pas}} avec Paul.", fa: "آن‌ها با پل حرف نمی‌زنند.", distractors: PAS, hint: "(منفی)" },
      { text: "Le chat {{n'est}} pas petit.", fa: "گربه کوچک نیست.", distractors: ["ne est", "est", "non est"], hint: "(منفی)" },
      { text: "Je {{ne}} parle {{pas}} français.", fa: "من فرانسوی حرف نمی‌زنم.", distractors: [NEG, PAS], meanings: { français: "فرانسوی" } },
      { text: "Vous {{ne}} mangez {{pas}} ici ?", fa: "شما اینجا غذا نمی‌خورید؟", distractors: [NEG, PAS] },
    ],
    transforms: [
      { instruction: "جمله را منفی کن.", source: "Je parle français.", outputs: ["Je ne parle pas français."] },
      { instruction: "جمله را منفی کن.", source: "Il est ici.", outputs: ["Il n'est pas ici."] },
      { instruction: "جمله را منفی کن.", source: "J'aime le café.", outputs: ["Je n'aime pas le café."] },
    ],
    translations: [
      { fa: "من اینجا نیستم.", outputs: ["Je ne suis pas ici."] },
      { fa: "او (مرد) قهوه دوست ندارد.", outputs: ["Il n'aime pas le café."] },
      { fa: "ما فرانسوی حرف نمی‌زنیم.", outputs: ["Nous ne parlons pas français."], meanings: { français: "فرانسوی" } },
    ],
  },
  {
    code: "fr-a1-aller",
    title: "aller: رفتن به جایی",
    scope: "زمان حال aller؛ à، à la، à l'، au",
    canDo: "حالا می‌توانی بگویی کجا می‌روی.",
    lesson:
      "aller یعنی «رفتن» و بی‌قاعده است: je vais، tu vas، il یا elle va، nous allons، vous allez، ils یا elles vont. برای «رفتن به جایی» à می‌آید: à Paris. à و le با هم au می‌شوند: au café، نه à le café. پیش از la همان à la می‌ماند (à la maison) و پیش از حرف صدادار à l' می‌شود (à l'école). Je vais bien هم یعنی «حالم خوب است».",
    table: [
      ["ضمیر", "aller", "معنی"],
      ["je", "vais", "می‌روم"],
      ["tu", "vas", "می‌روی"],
      ["il / elle", "va", "می‌رود"],
      ["nous", "allons", "می‌رویم"],
      ["vous", "allez", "می‌روید"],
      ["ils / elles", "vont", "می‌روند"],
    ],
    examples: [
      { text: "Je vais à Paris.", fa: "من به پاریس می‌روم." },
      { text: "Tu vas au café ?", fa: "به کافه می‌روی؟", meanings: { café: "کافه" } },
      { text: "Nous allons à l'école.", fa: "ما به مدرسه می‌رویم." },
    ],
    rule: "aller: vais، vas، va، allons، allez، vont. à + le = au.",
    mistake: "à le غلط است؛ همیشه au بگو: Je vais au travail.",
    targets: [
      { text: "Je {{vais}} à l'école.", fa: "من به مدرسه می‌روم.", distractors: ["vas", "va", "allons"], hint: "(aller)" },
      { text: "Tu {{vas}} à Paris ?", fa: "به پاریس می‌روی؟", distractors: ["vais", "va", "allez"], hint: "(aller)" },
      { text: "Paul {{va}} au travail.", fa: "پل سر کار می‌رود.", distractors: ["vas", "vont", "vais"], hint: "(aller)", meanings: { au: "سرِ" } },
      { text: "Nous {{allons}} au café.", fa: "ما به کافه می‌رویم.", distractors: ["allez", "vont", "vais"], hint: "(aller)", meanings: { café: "کافه" } },
      { text: "Vous {{allez}} bien ?", fa: "حالتان خوب است؟", distractors: ["allons", "vas", "vont"], hint: "(aller)", meanings: { allez: "(حالتان) … است", bien: "خوب" } },
      { text: "Ils {{vont}} à la maison.", fa: "آن‌ها به خانه می‌روند.", distractors: ["va", "allez", "sont"], hint: "(aller)" },
      { text: "Je {{vais}} bien, merci.", fa: "حالم خوب است، ممنون.", distractors: ["vas", "va", "allons"], hint: "(aller)", meanings: { vais: "(حالم) … است", bien: "خوب" } },
      { text: "Je vais {{au}} café.", fa: "من به کافه می‌روم.", distractors: ["à le", "à la", "en"], hint: "(به)", meanings: { café: "کافه" } },
      { text: "Elle va {{à la}} maison.", fa: "او به خانه می‌رود.", distractors: ["au", "à le", "en"], hint: "(به)" },
      { text: "Tu vas {{à l'}}école ?", fa: "به مدرسه می‌روی؟", distractors: ["au", "à la", "à le"], hint: "(به)" },
      {
        text: "Je {{vais}} à Paris et tu {{vas}} à Lyon.",
        fa: "من به پاریس می‌روم و تو به لیون می‌روی.",
        distractors: [
          ["vas", "va", "allons"],
          ["vais", "va", "allez"],
        ],
      },
    ],
    transforms: [
      { instruction: "جمله را با nous بنویس.", source: "Je vais à Paris.", outputs: ["Nous allons à Paris."] },
      { instruction: "به‌جای Paris بنویس le café.", source: "Je vais à Paris.", outputs: ["Je vais au café."] },
      { instruction: "جمله را با ils بنویس.", source: "Il va à l'école.", outputs: ["Ils vont à l'école."] },
    ],
    translations: [
      { fa: "من به مدرسه می‌روم.", outputs: ["Je vais à l'école."] },
      { fa: "پل به کافه می‌رود.", outputs: ["Paul va au café."], meanings: { café: "کافه" } },
      { fa: "حالت خوب است؟", outputs: ["Tu vas bien ?", "Vous allez bien ?"], meanings: { vas: "(حالت) … است", bien: "خوب" } },
    ],
  },
];
