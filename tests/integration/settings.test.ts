import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listLog } from "@/server/content/library/history";
import { revertChange } from "@/server/content/library/revert";
import { engineValues, saveEngineSettings } from "@/server/settings/engine";
import { generalSettingsView, saveGeneralSettings } from "@/server/settings/general";
import { resetDb, testDb } from "./db";

beforeEach(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
});
afterAll(() => testDb.$disconnect());

const ADMIN = 1;
const logRows = () => testDb.adminLog.findMany({ orderBy: { id: "asc" } });
const stored = async (key: string) => (await testDb.appSetting.findUnique({ where: { key } }))?.value;

describe("«تنظیمات موتور» (PRD §9.8, §13.2)", () => {
  it("saves nothing when one value is out of range or breaks a rule between keys", async () => {
    expect(await saveEngineSettings({ "session.resume_hours": 99, "quick.minutes": 5 }, ADMIN)).toEqual({
      state: "invalid",
      errors: [{ key: "session.resume_hours", message: "باید بین ۱ و ۴۸ باشد." }],
    });
    const broken = await saveEngineSettings({ "share.review": 0.6 }, ADMIN);
    expect(broken.state).toBe("invalid");
    expect(broken.state === "invalid" && broken.errors.map((error) => error.key)).toEqual(["share.review"]);
    expect(await testDb.engineSetting.count()).toBe(0);
    expect(await logRows()).toEqual([]);
  });

  it("saves the changed keys with one log row each, and skips the unchanged ones", async () => {
    const result = await saveEngineSettings({ "share.review": 0.5, "share.new": 0.25, "share.notebook": 0.15, "session.resume_hours": 8 }, ADMIN);
    expect(result).toEqual({ state: "saved", changed: ["share.review", "share.new", "session.resume_hours"] });
    const values = await engineValues();
    expect([values["share.review"], values["share.new"], values["session.resume_hours"]]).toEqual([0.5, 0.25, 8]);
    const rows = await logRows();
    expect(rows.map((row) => [row.entity, row.entity_id, row.before, row.after])).toEqual([
      ["engine_setting", "share.review", { value: 0.55 }, { value: 0.5 }],
      ["engine_setting", "share.new", { value: 0.2 }, { value: 0.25 }],
      ["engine_setting", "session.resume_hours", { value: 6 }, { value: 8 }],
    ]);
    const row = await testDb.engineSetting.findUniqueOrThrow({ where: { key: "session.resume_hours" } });
    expect([row.default_value, row.min_value, row.max_value, row.updated_by]).toEqual([6, 1, 48, ADMIN]);
  });

  it("puts a key back, unless it changed again or the old value no longer fits", async () => {
    await saveEngineSettings({ "session.resume_hours": 8 }, ADMIN);
    const [hours] = await logRows();
    expect(await revertChange(hours.id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect((await engineValues())["session.resume_hours"]).toBe(6);

    // Two shares moved together: putting back only one would break the 100% rule.
    await saveEngineSettings({ "share.review": 0.5, "share.new": 0.25 }, ADMIN);
    const review = (await logRows()).find((row) => row.entity_id === "share.review")!;
    expect(await revertChange(review.id, ADMIN)).toEqual({ state: "blocked", reason: "invalid" });

    await saveEngineSettings({ "share.review": 0.45, "share.new": 0.3 }, ADMIN);
    expect(await revertChange(review.id, ADMIN)).toEqual({ state: "blocked", reason: "later" });
  });

  it("shows the change in «تاریخچه تغییرها» under «تنظیمات»", async () => {
    await saveEngineSettings({ "share.review": 0.5, "share.new": 0.25 }, ADMIN);
    const page = await listLog("settings", 1);
    expect(page.items).toHaveLength(2);
    const item = page.items.find((entry) => entry.title?.text === "سهم مرور در جلسه ترکیبی.")!;
    expect(item.kindLabel).toBe("تنظیمات موتور");
    expect(item.href).toBe("/admin/settings/engine#setting-share.review");
    expect(item.lines).toEqual([{ key: "value", label: "جلسه تمرین", before: { text: "۵۵٪", voice: "fa" }, after: { text: "۵۰٪", voice: "fa" } }]);
    expect((await listLog("words", 1)).items).toEqual([]);
  });
});

describe("«تنظیمات عمومی» (PRD §13.2)", () => {
  it("stores each field in the shape the app reads and keeps the keys the page does not show", async () => {
    const result = await saveGeneralSettings(
      {
        "prompt.sentence_length": { A1: [4, 9], A2: [5, 12], B1: [6, 15], B2: [6, 18] },
        "batch.sizes": { "P-C": 150, "P-W": 50, "P-S": 10, "P-X": 20, "P-E": 5, "P-WR": 5 },
        chatbot_names: [" ChatGPT", "Claude ", "DeepSeek"],
        "coming_soon_fa.fr": "  سطح A2 حدود آذر اضافه می‌شود. ",
        pace_estimate_fa: { "10": "", "15": "با ۱۵ دقیقه در روز، سطح A1 حدود ۴ ماه طول می‌کشد.", "20": "", "30": "" },
      },
      ADMIN,
    );
    expect(result.state).toBe("saved");
    expect(result.state === "saved" && result.changed).toEqual(["prompt.sentence_length", "batch.sizes", "chatbot_names", "coming_soon_fa.fr", "pace_estimate_fa"]);
    expect(await stored("prompt.sentence_length")).toEqual({ A1: "4 تا 9", A2: "5 تا 12", B1: "6 تا 15", B2: "6 تا 18" });
    expect(await stored("batch.sizes")).toMatchObject({ "P-C": 150, "P-QA": 100 });
    expect(await stored("chatbot_names")).toEqual(["ChatGPT", "Claude", "DeepSeek"]);
    expect(await stored("pace_estimate_fa")).toEqual({ "15": "با ۱۵ دقیقه در روز، سطح A1 حدود ۴ ماه طول می‌کشد." });
    expect((await testDb.language.findUniqueOrThrow({ where: { code: "fr" } })).coming_soon_fa).toBe("سطح A2 حدود آذر اضافه می‌شود.");

    const view = await generalSettingsView();
    expect(view.find((field) => field.id === "prompt.sentence_length")?.value).toEqual({ A1: [4, 9], A2: [5, 12], B1: [6, 15], B2: [6, 18] });
    expect(view.find((field) => field.id === "coming_soon_fa.fr")?.language).toBe("fr");
  });

  it("saves nothing when one field is wrong, and nothing at all when nothing changed", async () => {
    const result = await saveGeneralSettings({ chatbot_names: ["Claude", "Gemini"], "prompt.writing_words": { B1: [120, 60], B2: [150, 250] } }, ADMIN);
    expect(result).toEqual({ state: "invalid", errors: [{ key: "prompt.writing_words.B1", message: "عدد اول نباید از دومی بیشتر باشد." }] });
    expect(await stored("chatbot_names")).toBeUndefined();
    expect(await saveGeneralSettings({ chatbot_names: ["ChatGPT", "Claude", "Gemini"] }, ADMIN)).toEqual({
      state: "saved",
      changed: [],
      values: { chatbot_names: ["ChatGPT", "Claude", "Gemini"] },
    });
    expect(await logRows()).toEqual([]);
  });

  it("logs a language text by language, puts it back, and empties it to «nothing written»", async () => {
    await saveGeneralSettings({ "support_contact_fa.de": "تلگرام: @polyra" }, ADMIN);
    await saveGeneralSettings({ "support_contact_fa.de": "" }, ADMIN);
    expect((await testDb.language.findUniqueOrThrow({ where: { code: "de" } })).support_contact_fa).toBeNull();
    const rows = await logRows();
    expect(rows.map((row) => [row.entity, row.entity_id, row.after])).toEqual([
      ["language_text", "de:support_contact_fa", { value: "تلگرام: @polyra" }],
      ["language_text", "de:support_contact_fa", { value: null }],
    ]);
    expect(await revertChange(rows[0].id, ADMIN)).toEqual({ state: "blocked", reason: "later" });
    expect(await revertChange(rows[1].id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect((await testDb.language.findUniqueOrThrow({ where: { code: "de" } })).support_contact_fa).toBe("تلگرام: @polyra");
  });

  it("puts a list back only while it still holds what that change wrote", async () => {
    await saveGeneralSettings({ chatbot_names: ["ChatGPT", "Claude", "Gemini", "DeepSeek"] }, ADMIN);
    const [row] = await logRows();
    await testDb.appSetting.update({ where: { key: "chatbot_names" }, data: { value: ["Claude"] } });
    expect(await revertChange(row.id, ADMIN)).toEqual({ state: "blocked", reason: "changed" });
    await testDb.appSetting.update({ where: { key: "chatbot_names" }, data: { value: ["ChatGPT", "Claude", "Gemini", "DeepSeek"] } });
    expect(await revertChange(row.id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect(await stored("chatbot_names")).toEqual(["ChatGPT", "Claude", "Gemini"]);
  });

  it("describes list, number and range changes in plain words", async () => {
    await saveGeneralSettings(
      {
        chatbot_names: ["ChatGPT", "Claude", "DeepSeek"],
        "prompt.writing_words": { B1: [70, 120], B2: [150, 250] },
        "targets.de": {
          A1: { words: 650, phrases: 50, grammar_units: 50, texts: 40, translations: 400, dialogues: 10, errorfix: 0, writing: 0 },
          A2: { words: 900, phrases: 100, grammar_units: 50, texts: 120, translations: 400, dialogues: 20, errorfix: 0, writing: 0 },
          B1: { words: 1500, phrases: 150, grammar_units: 50, texts: 100, translations: 400, dialogues: 25, errorfix: 60, writing: 20 },
          B2: { words: 2000, phrases: 200, grammar_units: 50, texts: 80, translations: 400, dialogues: 25, errorfix: 60, writing: 20 },
        },
      },
      ADMIN,
    );
    const items = (await listLog("settings", 1)).items;
    const byTitle = (title: string) => items.find((item) => item.title?.text === title)!;
    expect(byTitle("نام چت‌بات‌ها").lines).toEqual([{ key: "chatbot_names", label: "نام چت‌بات‌ها", note: "اضافه شد: \u2066DeepSeek\u2069؛ برداشته شد: \u2066Gemini\u2069" }]);
    expect(byTitle("طول جواب تمرین نوشتن").lines).toEqual([{ key: "B1", label: "⁦B1⁩", before: { text: "۶۰ تا ۱۲۰", voice: "fa" }, after: { text: "۷۰ تا ۱۲۰", voice: "fa" } }]);
    const targets = byTitle("تعداد هدف هر سطح (آلمانی)");
    expect(targets.href).toBe("/admin/settings/general?lang=de#targets.de");
    expect(targets.lines).toEqual([{ key: "A1.words", label: "⁦A1⁩ · کلمه", before: { text: "۶۰۰", voice: "fa" }, after: { text: "۶۵۰", voice: "fa" } }]);
  });
});
