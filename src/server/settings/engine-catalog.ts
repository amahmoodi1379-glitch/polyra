/**
 * Every engine number of PRD §9.8, with its default, the allowed range and a plain Persian
 * description for the panel. The seed copies this into `engine_setting`; at runtime the database
 * is the source of truth and the panel refuses values outside [min, max] (PRD §13.2).
 *
 * The ranges are not in the PRD. They are safety limits chosen to stop typing mistakes
 * (see DECISIONS.md) and can be widened later without a code change to the engine.
 */

export type SettingType =
  /** whole number */
  | "int"
  /** decimal number */
  | "number"
  /** share between 0 and 1, shown as a percent */
  | "ratio"
  /** on or off */
  | "bool"
  /** whole number that may be left empty */
  | "optional_int"
  /** one of a fixed list of whole numbers */
  | "choice"
  /** FSRS weights; empty means the library's own defaults */
  | "weights";

export type SettingGroup =
  | "memory"
  | "session"
  | "new"
  | "backlog"
  | "notebook"
  | "pace"
  | "placement"
  | "text"
  | "speak"
  | "streak"
  | "time"
  | "exercise"
  | "feature"
  | "publish"
  | "account";

export type EngineSettingDef = {
  key: string;
  type: SettingType;
  default: number | boolean | number[] | null;
  min?: number;
  max?: number;
  options?: number[];
  group: SettingGroup;
  description_fa: string;
};

/** Persian names of the groups, in the order the panel shows them. */
export const settingGroups: Record<SettingGroup, string> = {
  memory: "حافظه و مرور",
  session: "جلسه تمرین",
  new: "مطلب جدید",
  backlog: "وقتی مرورها عقب افتاده",
  notebook: "دفترچه اشتباهات و کلمه سمج",
  pace: "سرعت و نجات",
  placement: "تعیین سطح و آزمون‌ها",
  text: "متن‌ها",
  speak: "گفتن و نوشتن",
  streak: "زنجیره و ایستگاه",
  time: "زمان تخمینی هر تمرین (ثانیه)",
  exercise: "روشن و خاموش کردن تمرین‌ها",
  feature: "قابلیت‌های پیشرفته",
  publish: "انتشار و سلامت محتوا",
  account: "حساب، دوره رایگان و پرداخت",
};

const int = (
  key: string,
  value: number,
  min: number,
  max: number,
  group: SettingGroup,
  description_fa: string,
): EngineSettingDef => ({ key, type: "int", default: value, min, max, group, description_fa });

const num = (
  key: string,
  value: number,
  min: number,
  max: number,
  group: SettingGroup,
  description_fa: string,
): EngineSettingDef => ({ key, type: "number", default: value, min, max, group, description_fa });

const ratio = (
  key: string,
  value: number,
  group: SettingGroup,
  description_fa: string,
  min = 0,
  max = 1,
): EngineSettingDef => ({ key, type: "ratio", default: value, min, max, group, description_fa });

const flag = (key: string, value: boolean, group: SettingGroup, description_fa: string): EngineSettingDef => ({
  key,
  type: "bool",
  default: value,
  min: 0,
  max: 1,
  group,
  description_fa,
});

/** Exercise codes that can be switched off. W1a, W2a and W5a always stay on (PRD §9.8). */
export const switchableExercises: { code: string; fa: string }[] = [
  { code: "W1b", fa: "شنیدن کلمه و انتخاب معنی" },
  { code: "W2b", fa: "دیدن تصویر و انتخاب کلمه" },
  { code: "W2c", fa: "دیدن کلمه و انتخاب تصویر" },
  { code: "W2d", fa: "انتخاب حرف تعریف" },
  { code: "W3a", fa: "شنیدن و انتخاب املای درست" },
  { code: "W3b", fa: "جمله با جای خالی و ۴ گزینه" },
  { code: "W3c", fa: "انتخاب ترجمه درست جمله" },
  { code: "W3d", fa: "جفت‌کردن ۵ کلمه با معنی" },
  { code: "W4a", fa: "مرتب‌کردن حروف به‌هم‌ریخته" },
  { code: "W4b", fa: "نوشتن حروف جاافتاده" },
  { code: "W4c", fa: "انتخاب شکل جمع (آلمانی)" },
  { code: "W5b", fa: "شنیدن و تایپ کلمه" },
  { code: "W6a", fa: "تایپ کلمه گمشده در جمله" },
  { code: "W6b", fa: "شنیدن جمله و تایپ کلمه گمشده" },
  { code: "G1a", fa: "دستور: جای خالی با ۴ گزینه" },
  { code: "G1b", fa: "دستور: کدام جمله درست است" },
  { code: "G2a", fa: "دستور: پیدا کردن بخش غلط" },
  { code: "G2b", fa: "دستور: شنیدن و انتخاب نوشته درست" },
  { code: "G2c", fa: "دستور: انتخاب جمله درست از روی ترجمه" },
  { code: "G3a", fa: "دستور: دسته‌بندی" },
  { code: "G3b", fa: "دستور: دو جای خالی" },
  { code: "G3c", fa: "دستور: جای خالی بدون ترجمه" },
  { code: "G4a", fa: "دستور: ساختن جمله از کلمه‌ها" },
  { code: "G4b", fa: "دستور: شنیدن و مرتب‌کردن کلمه‌ها" },
  { code: "G5a", fa: "دستور: تایپ شکل درست با راهنما" },
  { code: "G5b", fa: "دستور: تایپ جای خالی بدون راهنما" },
  { code: "G6", fa: "دستور: تبدیل جمله" },
  { code: "G6b", fa: "ترجمه کوتاه" },
  { code: "C1", fa: "کارت صرف: تمرین ۱" },
  { code: "C2", fa: "کارت صرف: تمرین ۲" },
  { code: "C3", fa: "کارت صرف: تمرین ۳" },
  { code: "C4", fa: "کارت صرف: تمرین ۴" },
  { code: "L1", fa: "شنیدن جمله: تمرین ۱" },
  { code: "L2", fa: "شنیدن جمله: مرتب‌کردن کلمه‌ها" },
  { code: "L3", fa: "شنیدن جمله: دیکته" },
  { code: "P1", fa: "آواشناسی: تمرین ۱" },
  { code: "P2", fa: "آواشناسی: تمرین ۲" },
  { code: "P3", fa: "آواشناسی: تمرین ۳" },
  { code: "P4", fa: "آواشناسی: تمرین ۴" },
  { code: "P5", fa: "آواشناسی: تمرین ۵" },
  { code: "S1", fa: "بگو، بعد بشنو" },
  { code: "S3", fa: "گفتگوی موقعیتی" },
  { code: "S4", fa: "غلط‌یابی" },
  { code: "S5", fa: "نوشتن هدایت‌شده" },
  { code: "Q-mcq", fa: "سؤال متن: چهارگزینه‌ای" },
  { code: "Q-tf", fa: "سؤال متن: درست یا غلط" },
  { code: "Q-order", fa: "سؤال متن: ترتیب" },
  { code: "Q-match", fa: "سؤال متن: جفت‌کردن" },
  { code: "Q-cloze", fa: "سؤال متن: جای خالی" },
  { code: "Q-find", fa: "سؤال متن: پیدا کردن جمله" },
  { code: "Q-ctx", fa: "سؤال متن: معنی کلمه در متن" },
  { code: "Q-num", fa: "سؤال متن: عدد و ساعت" },
  { code: "Q-dict", fa: "سؤال متن: دیکته" },
];

export const engineCatalog: EngineSettingDef[] = [
  // Memory (PRD §9.1)
  ratio("fsrs.request_retention", 0.9, "memory", "چقدر می‌خواهیم کاربر یادش بماند. بالاتر یعنی مرور بیشتر.", 0.7, 0.97),
  int("fsrs.maximum_interval", 365, 30, 3650, "memory", "بیشترین فاصله بین دو مرور (روز)."),
  {
    key: "fsrs.weights",
    type: "weights",
    default: null,
    group: "memory",
    description_fa: "وزن‌های حافظه. فقط بعد از بهینه‌سازی با داده واقعی عوض شود. خالی یعنی پیش‌فرض کتابخانه.",
  },
  {
    key: "new.first_interval_days",
    type: "optional_int",
    default: 1,
    min: 1,
    max: 7,
    group: "memory",
    description_fa: "اولین مرور آیتم تازه چند روز بعد باشد. خالی یعنی همان فاصله خود حافظه.",
  },
  int("followup.gap", 4, 1, 20, "memory", "حداقل چند تمرین بین مرور و تمرین بعدی همان آیتم فاصله باشد."),
  int("practice.gap", 3, 1, 20, "memory", "حداقل چند تمرین قبل از تکرار جواب غلط."),
  int("practice.max_per_item", 2, 0, 5, "memory", "هر آیتم در یک جلسه حداکثر چند بار تکرار شود."),
  ratio("fast.ratio", 0.6, "memory", "جواب «سریع»: زمان جواب کمتر از این سهم از زمان معمول کاربر.", 0.2, 1),
  int("fast.min_samples", 20, 5, 200, "memory", "برای سنجیدن «سریع»، حداقل چند جواب قبلی لازم است."),
  int("near.max_streak", 3, 1, 10, "memory", "چندمین «تقریباً درست» پشت‌سرهم، غلط حساب شود."),
  int("stable.step", 4, 3, 6, "memory", "پله‌ای که کلمه نوشتنی از آن به بعد «پایدار» است."),
  ratio("known.threshold", 0.9, "memory", "چه سهمی از کلمه‌های جمله یا متن باید برای کاربر آشنا باشد.", 0.5, 1),
  int("tolerance.min_length", 5, 3, 15, "memory", "از چند حرف به بالا، یک حرف اشتباه «تقریباً درست» است."),
  ratio("w4b.hide_ratio", 0.4, "memory", "در تمرین «حروف جاافتاده» چه سهمی از حروف پنهان شود.", 0.1, 0.8),

  // Session (PRD §10)
  ratio("share.review", 0.55, "session", "سهم مرور در جلسه ترکیبی."),
  ratio("share.notebook", 0.15, "session", "سهم دفترچه اشتباهات در جلسه ترکیبی."),
  ratio("share.production", 0.1, "session", "سهم تمرین گفتن و نوشتن در جلسه ترکیبی."),
  ratio("share.new", 0.2, "session", "سهم مطلب جدید در جلسه ترکیبی."),
  {
    key: "session.default_length",
    type: "choice",
    default: 15,
    min: 10,
    max: 30,
    options: [10, 15, 20, 30],
    group: "session",
    description_fa: "طول پیش‌فرض جلسه (دقیقه).",
  },
  int("quick.minutes", 5, 3, 15, "session", "طول جلسه «امروز وقت کم دارم» (دقیقه)."),
  int("session.resume_hours", 6, 1, 48, "session", "جلسه نیمه‌کاره تا چند ساعت قابل ادامه است."),
  ratio("session.overrun", 0.3, "session", "مطلب جدید تا چه حد می‌تواند از زمان باقی‌مانده جلسه بیرون بزند."),
  num("session.time_guard", 1.3, 1, 3, "session", "اگر جلسه از این ضریبِ زمانش طولانی‌تر شد، تمرین‌های اضافه حذف شوند."),
  int("cap.rounds_per_5min", 1, 0, 5, "session", "حداکثر دور مرور دستور به ازای هر ۵ دقیقه جلسه."),
  int("phonics.position", 3, 1, 20, "session", "دور آواشناسی چندمین تمرین جلسه باشد."),
  int("phonics.max_skips", 3, 1, 10, "session", "بعد از چند بار «بعداً»، آواشناسی خودکار خاموش شود."),
  ratio("phonics.retry_below", 0.6, "session", "اگر نمره دور ۲ آواشناسی کمتر از این بود، تکرار شود."),
  int("audio.wait_sec", 5, 1, 30, "session", "حداکثر انتظار برای رسیدن صدای یک تمرین (ثانیه)."),
  int("abandon.sessions", 3, 1, 10, "session", "بعد از چند جلسه نیمه‌کاره، جلسه کوتاه‌تر پیشنهاد شود."),
  int("abandon.cooldown_days", 30, 1, 180, "session", "فاصله تا پیشنهاد دوباره جلسه کوتاه‌تر (روز)."),

  // New material (PRD §3.7, §10.5)
  int("new.words_per_5min", 5, 0, 20, "new", "حداکثر کلمه جدید در هر جلسه، به ازای هر ۵ دقیقه."),
  int("new.words_daily_soft", 20, 0, 200, "new", "سقف نرم کلمه جدید در روز."),
  int("new.words_daily_step", 10, 1, 50, "new", "هر بار که کاربر «بیشتر» می‌خواهد، سقف روزانه چقدر بالا برود."),
  int("new.words_daily_hard", 50, 0, 300, "new", "سقف سخت کلمه جدید در روز."),
  int("new.units_daily", 3, 0, 10, "new", "حداکثر واحد دستوری جدید در روز."),
  int("new.units_per_10min", 1, 0, 5, "new", "حداکثر واحد دستوری جدید در هر جلسه، به ازای هر ۱۰ دقیقه."),
  int("new.conj_per_session", 3, 0, 10, "new", "حداکثر کارت صرف جدید در هر جلسه."),
  int("new.conj_daily", 6, 0, 20, "new", "حداکثر کارت صرف جدید در روز."),
  int("new.text_sec_daily", 900, 0, 3600, "new", "حداکثر زمان متن جدید در روز برای هر مسیر (ثانیه)."),
  int("queue.daily", 5, 0, 30, "new", "حداکثر کلمه در روز از کلمه‌های لمس‌شده و کلیدی."),
  int("queue.expire_days", 30, 1, 180, "new", "کلمه لمس‌شده تا چند روز در صف می‌ماند."),
  int("intro.family_gap.fr", 4, 0, 20, "new", "فرانسوی: حداقل فاصله دو کلمه هم‌دسته (مثل دو رنگ) در ترتیب معرفی. صفر یعنی خاموش."),
  int("intro.family_gap.de", 4, 0, 20, "new", "آلمانی: حداقل فاصله دو کلمه هم‌دسته در ترتیب معرفی. صفر یعنی خاموش."),
  int("mastery.produce_rank", 2000, 100, 20000, "new", "در B1 و B2، کلمه‌هایی که رتبه فراوانی‌شان تا این عدد است «نوشتنی» می‌شوند."),
  int("gate.grammar_words", 20, 0, 200, "new", "دستور بعد از معرفی چند کلمه باز شود."),
  int("gate.drill_words", 30, 0, 300, "new", "تمرین شنیدن جمله بعد از معرفی چند کلمه باز شود."),
  int("grammar.unlock_after_rounds", 3, 1, 10, "new", "بعد از چند دور ناموفق، واحد دستوری بعدی باز شود."),
  int("iknow.daily", 10, 0, 50, "new", "حداکثر «این را بلدم» در روز."),
  int("pretest.trigger_count", 5, 1, 20, "new", "چند «این را بلدم» حالت پیش‌آزمون را روشن می‌کند…"),
  int("pretest.window", 20, 5, 100, "new", "…از میان چند کلمه اخیر."),
  int("pretest.daily", 30, 0, 100, "new", "حداکثر کلمه ردشده با پیش‌آزمون در روز."),
  ratio("pretest.off_below", 0.5, "new", "اگر دقت پیش‌آزمون کمتر از این شد، حالت پیش‌آزمون خاموش شود."),

  // Backlog (PRD §10.6)
  int("backlog.per_5min", 15, 5, 100, "backlog", "اگر مرورهای عقب‌افتاده بیش از این عدد به ازای هر ۵ دقیقه شد، حالت عقب‌افتادگی."),
  int("backlog.spread_days", 14, 1, 60, "backlog", "مرورهای عقب‌افتاده در چند روز پخش شوند."),
  ratio("backlog.share.review", 0.75, "backlog", "سهم مرور در حالت عقب‌افتادگی."),
  ratio("backlog.share.notebook", 0.15, "backlog", "سهم دفترچه در حالت عقب‌افتادگی."),
  ratio("backlog.share.production", 0, "backlog", "سهم گفتن و نوشتن در حالت عقب‌افتادگی."),
  ratio("backlog.share.new", 0.1, "backlog", "سهم مطلب جدید در حالت عقب‌افتادگی."),

  // Notebook, leeches and confusion (PRD §9.5, §9.9)
  int("notebook.days", 7, 1, 60, "notebook", "هر اشتباه تا چند روز در دفترچه می‌ماند."),
  int("notebook.exit_correct", 2, 1, 10, "notebook", "با چند جواب درست در روزهای مختلف از دفترچه بیرون برود."),
  int("notebook.max", 30, 5, 200, "notebook", "حداکثر تعداد موارد دفترچه."),
  int("leech.threshold", 4, 2, 20, "notebook", "بعد از چند جواب غلط، کلمه «سمج» حساب شود."),
  int("leech.rest_days", 7, 1, 60, "notebook", "کلمه سمج چند روز استراحت کند."),
  int("confusion.min_count", 2, 1, 10, "notebook", "بعد از چند بار قاطی‌کردن، کارت «این دو را قاطی می‌کنی» بیاید."),
  int("confusion.card_gap_days", 7, 1, 60, "notebook", "فاصله نمایش دوباره همان کارت (روز)."),

  // Pace and rescue (PRD §9.10)
  int("pace.window_days", 7, 3, 30, "pace", "سرعت کاربر از روی مرورهای چند روز اخیر سنجیده شود."),
  int("pace.min_reviews", 30, 10, 300, "pace", "برای سنجیدن سرعت، حداقل چند مرور لازم است."),
  ratio("pace.slow_below", 0.75, "pace", "اگر دقت کمتر از این شد، «سرعت کم» روشن شود.", 0.3, 1),
  ratio("pace.normal_at", 0.85, "pace", "اگر دقت به این رسید، سرعت عادی برگردد.", 0.3, 1),
  ratio("pace.slow_factor", 0.5, "pace", "در «سرعت کم»، سقف مطلب جدید در این عدد ضرب شود.", 0.1, 1),
  int("rescue.wrong_streak", 3, 2, 10, "pace", "بعد از چند غلط پشت‌سرهم، تمرین آسان بیاید."),
  int("rescue.easy_items", 2, 0, 5, "pace", "چند تمرین آسان بیاید."),
  int("rescue.min_answers", 10, 3, 50, "pace", "بعد از چند جواب، دقت جلسه سنجیده شود."),
  ratio("rescue.session_accuracy", 0.6, "pace", "اگر دقت جلسه کمتر از این بود، مطلب جدیدِ مانده حذف شود.", 0.2, 1),
  int("leveldown.window_days", 14, 7, 60, "pace", "پیشنهاد سطح پایین‌تر: دقت چند روز اخیر سنجیده شود."),
  int("leveldown.min_reviews", 30, 10, 300, "pace", "پیشنهاد سطح پایین‌تر: حداقل چند مرور لازم است."),
  ratio("leveldown.accuracy", 0.5, "pace", "پیشنهاد سطح پایین‌تر: دقت کمتر از این.", 0.2, 0.9),
  int("leveldown.cooldown_days", 14, 1, 90, "pace", "تا چند روز دوباره پرسیده نشود."),

  // Placement and exams (PRD §11)
  int("placement.block_size", 10, 5, 30, "placement", "تعیین سطح: تعداد سؤال هر بخش."),
  int("placement.pass_min", 8, 1, 30, "placement", "تعیین سطح: حداقل جواب درست برای قبولی هر بخش."),
  ratio("placement.text_pass", 0.75, "placement", "تعیین سطح: نمره لازم در متن.", 0.3, 1),
  int("sample.words", 30, 5, 100, "placement", "نمونه آزمایشی بعد از تعیین سطح: تعداد کلمه."),
  int("sample.sentences", 10, 3, 50, "placement", "نمونه آزمایشی: تعداد جمله دستور."),
  ratio("sample.pass_ratio", 0.8, "placement", "نمونه آزمایشی: سهم جواب درست برای قبولی.", 0.5, 1),
  int("exam.size", 15, 5, 50, "placement", "آزمون پرش از سطح: تعداد سؤال."),
  int("exam.pass_min", 12, 1, 50, "placement", "آزمون پرش: حداقل جواب درست."),
  int("exam.cooldown_days", 7, 1, 60, "placement", "آزمون پرش: فاصله تا تلاش دوباره (روز)."),

  // Texts (PRD §7)
  int("text.gap2_days", 3, 1, 30, "text", "فاصله تلاش دوم متن (روز)."),
  int("text.gap3_days", 14, 1, 90, "text", "فاصله تلاش سوم متن (روز)."),
  int("text.cross_gap_days", 30, 1, 365, "text", "فاصله لازم برای استفاده از متن مسیر دیگر (روز)."),
  int("text.session_every", 3, 1, 20, "text", "بعد از چند جلسه بدون متن، «جلسه متن» پیشنهاد شود."),
  ratio("text.jump_score", 0.85, "text", "نمره‌ای که با آن متن بعدی سخت‌تر انتخاب می‌شود.", 0.5, 1),
  ratio("text.levelup_score", 0.8, "text", "نمره لازم در متن‌ها برای بالا رفتن سطح.", 0.5, 1),
  int("text.levelup_min", 8, 1, 50, "text", "حداقل تعداد متن برای بالا رفتن سطح."),
  int("text.due_per_15min", 1, 0, 5, "text", "حداکثر تلاش متنِ موعدرسیده در جلسه ترکیبی، به ازای هر ۱۵ دقیقه."),
  ratio("text.max_share", 0.6, "text", "حداکثر سهم یک متن از زمان جلسه ترکیبی.", 0.1, 1),
  int("text.resume_hours", 24, 1, 72, "text", "تلاش نیمه‌تمام متن تا چند ساعت قابل ادامه است."),
  int("text.track_window", 5, 1, 20, "text", "نمره هر مسیر از روی چند متن اخیر حساب شود."),
  int("keywords.max", 5, 0, 10, "text", "حداکثر کلمه کلیدی هر متن."),
  int("drill.max_words", 12, 4, 30, "text", "تمرین شنیدن جمله: حداکثر طول جمله (کلمه)."),
  int("drill.gap_days", 3, 1, 30, "text", "تمرین شنیدن جمله: فاصله تکرار (روز)."),
  int("drill.max_count", 3, 1, 10, "text", "تمرین شنیدن جمله: هر جمله حداکثر چند بار."),

  // Speaking and writing (PRD §8b)
  int("speak.max_words_low", 8, 3, 20, "speak", "«بگو، بعد بشنو» تا A2: حداکثر طول جمله (کلمه)."),
  int("speak.max_words_high", 14, 5, 30, "speak", "«بگو، بعد بشنو» از B1: حداکثر طول جمله (کلمه)."),
  int("speak.gap_no", 2, 1, 30, "speak", "«بلد نبودم»: چند روز بعد دوباره بیاید."),
  int("speak.gap_near", 4, 1, 60, "speak", "«تقریباً»: چند روز بعد دوباره بیاید."),
  int("speak.gap_ok", 10, 1, 90, "speak", "«درست گفتم»: چند روز بعد دوباره بیاید."),
  int("speak.max_shows", 4, 1, 10, "speak", "هر جمله حداکثر چند بار نشان داده شود."),
  int("speak.done_after_ok", 2, 1, 10, "speak", "بعد از چند «درست گفتم» جمله تمام شود."),
  int("gate.dialogue_words", 100, 0, 1000, "speak", "گفتگوی موقعیتی بعد از معرفی چند کلمه باز شود."),
  int("dialogue.gap_days", 7, 1, 60, "speak", "فاصله تلاش دوباره گفتگو (روز)."),
  int("errorfix.gap_days", 7, 1, 60, "speak", "فاصله تلاش دوباره غلط‌یابی (روز)."),
  int("writing.per_week", 1, 0, 7, "speak", "تمرین نوشتن در هفته."),
  int("writing.max_minutes", 20, 5, 60, "speak", "حداکثر زمان تمرین نوشتن (دقیقه)."),

  // Streak and station (PRD §3.9)
  int("station.words", 50, 10, 500, "streak", "هر چند کلمه یک ایستگاه."),
  int("station.units", 5, 1, 50, "streak", "هر چند واحد دستوری یک ایستگاه."),
  int("streak.forgive_per_week", 1, 0, 3, "streak", "چند روز بخشش در هفته."),
  int("freeze.min_daily_minutes", 15, 5, 60, "streak", "برای گرفتن یخ زنجیره، حداقل چند دقیقه یادگیری در روز."),
  int("freeze.max", 2, 0, 10, "streak", "حداکثر یخ زنجیره."),
  int("active.cap_sec", 60, 10, 300, "streak", "هر جواب حداکثر چند ثانیه در «یادگیری فعال» شمرده شود."),

  // Time per exercise (PRD §10.1)
  int("time.choice", 10, 3, 60, "time", "تمرین تستی و لمسی (چهارگزینه‌ای، درست و غلط، تصویر، حرف تعریف، پیش‌آزمون)."),
  int("time.type_word", 20, 5, 90, "time", "تایپ کلمه."),
  int("time.type_sentence", 30, 10, 120, "time", "تایپ جمله یا جدول."),
  int("time.arrange", 25, 5, 90, "time", "مرتب‌سازی، جفت‌کردن، کشیدن."),
  int("time.intro_card", 10, 3, 60, "time", "کارت آشنایی کلمه."),
  int("time.grammar_lesson", 60, 15, 300, "time", "درسنامه دستور."),
  int("time.g0", 8, 3, 30, "time", "هر تمرین کوتاهِ بعد از درسنامه."),
  int("time.l1", 12, 3, 60, "time", "شنیدن جمله: تمرین ۱."),
  int("time.l2", 25, 5, 90, "time", "شنیدن جمله: مرتب‌کردن."),
  int("time.l3", 30, 5, 120, "time", "شنیدن جمله: دیکته."),
  int("time.phonics_round1", 80, 20, 300, "time", "دور اول آواشناسی."),
  int("time.phonics_round2", 60, 20, 300, "time", "دور دوم آواشناسی."),
  num("time.listen1_audio_factor", 3, 1, 6, "time", "تلاش اول شنیداری: مدت صوت در این عدد ضرب می‌شود."),
  int("time.listen1_per_question", 20, 5, 60, "time", "تلاش اول شنیداری: زمان هر سؤال."),
  num("time.listen2_plays", 1.5, 1, 4, "time", "تلاش دوم شنیداری: تعداد پخش."),
  num("time.listen3_plays", 1, 1, 4, "time", "تلاش سوم شنیداری: تعداد پخش."),
  int("time.listen23_per_question", 15, 5, 60, "time", "تلاش دوم و سوم شنیداری: زمان هر سؤال."),
  int("time.read_words_per_min", 120, 40, 300, "time", "سرعت خواندن (کلمه در دقیقه)."),
  num("time.read1_factor", 2, 1, 4, "time", "تلاش اول خواندن: زمان خواندن در این عدد ضرب می‌شود."),
  int("time.read1_per_question", 20, 5, 60, "time", "تلاش اول خواندن: زمان هر سؤال."),
  int("time.read23_per_question", 15, 5, 60, "time", "تلاش دوم و سوم خواندن: زمان هر سؤال."),
  int("time.speak", 20, 5, 90, "time", "«بگو، بعد بشنو»."),
  int("time.dialogue_turn", 20, 5, 90, "time", "هر نوبت گفتگوی موقعیتی."),
  int("time.errorfix", 60, 15, 300, "time", "غلط‌یابی."),

  // Exercise switches (PRD §9.8, §13.6)
  ...switchableExercises.map(({ code, fa }) => flag(`exercise.${code}.enabled`, true, "exercise", fa)),

  // Advanced features (PRD §9.12)
  flag("feature.pretest", false, "feature", "حالت پیش‌آزمون: کاربری که زیاد «این را بلدم» می‌زند، اول تست می‌شود."),
  flag("feature.confusion_card", false, "feature", "کارت «این دو را قاطی می‌کنی»."),
  flag("feature.leveldown", false, "feature", "پیشنهاد «یک سطح پایین‌تر»."),

  // Publishing and content health (PRD §5.10, §6.7, §13.11)
  int("publish.word_min_targets", 5, 1, 20, "publish", "هر کلمه برای انتشار حداقل چند جمله تمرینی لازم دارد."),
  int("publish.word_goal_targets", 8, 1, 30, "publish", "هدف تعداد جمله تمرینی هر کلمه. کمتر از این «ناقص» نشان داده می‌شود."),
  int("publish.unit_min_targets", 30, 5, 100, "publish", "هر واحد دستوری برای انتشار حداقل چند جمله تمرینی لازم دارد."),
  int("health.min_usable_sentences", 3, 1, 10, "publish", "کلمه‌ای که کمتر از این جمله قابل‌استفاده دارد علامت می‌خورد."),
  int("report.auto_high", 3, 1, 20, "publish", "اگر چند کاربر مختلف یک آیتم را گزارش کنند، اولویت «بالا» شود."),

  // Accounts, trial and payment (PRD §12, §15.5)
  int("trial.hours", 72, 0, 720, "account", "طول دوره رایگان، از پایان اولین جلسه (ساعت)."),
  int("device.max", 2, 1, 5, "account", "حداکثر دستگاه فعال هر حساب."),
  int("order.expire_minutes", 30, 5, 240, "account", "سفارش پرداخت‌نشده بعد از چند دقیقه منقضی شود."),
  int("order.followup_hours", 24, 1, 168, "account", "تا چند ساعت وضعیت سفارش از درگاه دوباره پرسیده شود."),
];
