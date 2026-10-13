import { describe, expect, it } from "vitest";
import { appSettingDefaults } from "@/server/settings/app-catalog";
import { engineCatalog } from "@/server/settings/engine-catalog";
import { checkRelations, checkValue, engineDef, shownValue } from "@/server/settings/engine-rules";
import { checkField, editedShape, fieldTitle, generalField, generalFields, logTarget, fieldOfLog, type GeneralField } from "@/server/settings/general-fields";

const defaults = Object.fromEntries(engineCatalog.map((def) => [def.key, def.default]));
const def = (key: string) => engineDef(key)!;
const field = (id: string) => generalField(id)!;
const keysOf = (errors: { key: string }[]) => errors.map((error) => error.key);

describe("engine settings (PRD §9.8, §13.2)", () => {
  it("accepts every default, on its own and together", () => {
    for (const setting of engineCatalog) expect(checkValue(setting, setting.default), setting.key).toBeNull();
    expect(checkRelations(defaults)).toEqual([]);
  });

  it("refuses a number outside its range, a fraction where a whole number goes, and a wrong type", () => {
    expect(checkValue(def("session.resume_hours"), 48)).toBeNull();
    expect(checkValue(def("session.resume_hours"), 49)).toBe("باید بین ۱ و ۴۸ باشد.");
    expect(checkValue(def("session.resume_hours"), 6.5)).toBe("عدد بدون اعشار بنویس.");
    expect(checkValue(def("session.resume_hours"), "6")).toBe("یک عدد بنویس.");
    expect(checkValue(def("fsrs.request_retention"), 0.98)).toBe("باید بین ۷۰٪ و ۹۷٪ باشد.");
    expect(checkValue(def("session.time_guard"), 1.25)).toBeNull();
  });

  it("checks switches, choices, empty numbers and memory weights", () => {
    const bool = engineCatalog.find((setting) => setting.type === "bool")!;
    expect(checkValue(bool, true)).toBeNull();
    expect(checkValue(bool, 1)).not.toBeNull();
    expect(checkValue(def("session.default_length"), 20)).toBeNull();
    expect(checkValue(def("session.default_length"), 25)).toBe("یکی از گزینه‌ها را انتخاب کن.");
    const optional = engineCatalog.find((setting) => setting.type === "optional_int")!;
    expect(checkValue(optional, null)).toBeNull();
    const weights = def("fsrs.weights");
    expect(checkValue(weights, null)).toBeNull();
    for (const count of [17, 19, 21])
      expect(
        checkValue(
          weights,
          Array.from({ length: count }, () => 0.5),
        ),
      ).toBeNull();
    expect(
      checkValue(
        weights,
        Array.from({ length: 18 }, () => 0.5),
      ),
    ).not.toBeNull();
  });

  it("keeps the shares of a session at 100% and reports it only on the keys that were changed", () => {
    const broken = { ...defaults, "share.review": 0.6 };
    expect(checkRelations(broken, new Set(["share.review"]))).toEqual([{ key: "share.review", message: "جمع سهم‌های جلسه ترکیبی باید ۱۰۰٪ شود؛ الان ۱۰۵٪ است." }]);
    expect(keysOf(checkRelations(broken))).toEqual(["share.review", "share.notebook", "share.production", "share.new"]);
    expect(checkRelations({ ...defaults, "share.review": 0.5, "share.new": 0.25 })).toEqual([]);
    expect(checkRelations({ ...defaults, "backlog.share.review": 0.5 }).length).toBeGreaterThan(0);
  });

  it("keeps a smaller number of a pair below or at its bigger one", () => {
    const passTooHigh = { ...defaults, "exam.pass_min": (defaults["exam.size"] as number) + 1 };
    expect(keysOf(checkRelations(passTooHigh, new Set(["exam.pass_min"])))).toEqual(["exam.pass_min"]);
    expect(keysOf(checkRelations(passTooHigh, new Set(["exam.size"])))).toEqual(["exam.size"]);
    expect(checkRelations({ ...defaults, "exam.pass_min": defaults["exam.size"] })).toEqual([]);
    // «below» refuses equal numbers.
    expect(keysOf(checkRelations({ ...defaults, "text.gap2_days": defaults["text.gap3_days"] }))).toEqual(["text.gap2_days", "text.gap3_days"]);
  });

  it("shows values the way the panel writes them", () => {
    expect(shownValue(def("share.review"), 0.55)).toBe("۵۵٪");
    expect(shownValue(def("session.time_guard"), 1.3)).toBe("۱٫۳");
    expect(shownValue(def("fsrs.weights"), null)).toBe("خالی");
    expect(
      shownValue(
        def("fsrs.weights"),
        Array.from({ length: 21 }, () => 1),
      ),
    ).toBe("۲۱ عدد");
  });
});

describe("general settings (PRD §13.2)", () => {
  it("accepts every default in the shape the page edits", () => {
    for (const item of generalFields) {
      const key = item.kind === "text" ? ("key" in item.source ? item.source.key : null) : item.key;
      const stored = key ? appSettingDefaults[key] : null;
      expect(checkField(item, editedShape(item, stored)), item.id).toEqual([]);
    }
  });

  it("reads the stored shapes: sentence lengths as «a تا b», prompt numbers per level, lessons", () => {
    expect(editedShape(field("prompt.sentence_length"), { A1: "4 تا 10", B2: "6 تا 18" })).toEqual({ A1: [4, 10], B2: [6, 18] });
    expect(editedShape(field("prompt.writing_words"), { B2: [150, 250], B1: [60, 120] })).toEqual({ B1: [60, 120], B2: [150, 250] });
    expect(editedShape(field("prompt.translation_length"), { B1: 14, A1: 10 })).toEqual({ A1: 10, B1: 14 });
    expect(editedShape(field("batch.sizes"), appSettingDefaults["batch.sizes"])).toEqual({ "P-C": 200, "P-W": 50, "P-S": 10, "P-X": 20, "P-E": 5, "P-WR": 5 });
    expect(editedShape(field("pace_estimate_fa"), {})).toEqual({ "10": "", "15": "", "20": "", "30": "" });
    expect(editedShape(field("coming_soon_fa.fr"), null)).toBe("");
  });

  it("checks lists: how many, empty, too long, and the same line twice", () => {
    const names = field("chatbot_names");
    expect(checkField(names, [])).toEqual([{ key: "chatbot_names", message: "دست‌کم ۱ مورد لازم است." }]);
    expect(
      checkField(
        names,
        Array.from({ length: 11 }, (_, index) => `bot ${index}`),
      )[0].message,
    ).toBe("بیشتر از ۱۰ مورد نمی‌شود.");
    expect(checkField(names, ["Claude", "claude "])[0].message).toBe("«claude» دو بار آمده.");
    expect(checkField(names, ["x".repeat(41)])[0].message).toBe("هر مورد حداکثر ۴۰ نویسه.");
    expect(keysOf(checkField(field("prompt.dialogue_situations"), { A1: ["کافه"], A2: [] }))).toEqual(["prompt.dialogue_situations.A2"]);
    expect(checkField(field("conjugation.tenses.fr"), { A1: [] })).toEqual([]);
  });

  it("checks numbers, tables and ranges place by place", () => {
    expect(keysOf(checkField(field("batch.sizes"), { "P-C": 0, "P-W": 50 }))).toEqual(["batch.sizes.P-C"]);
    expect(keysOf(checkField(field("batch.sizes"), { "P-C": 2.5 }))).toEqual(["batch.sizes.P-C"]);
    const targets = editedShape(field("targets.fr"), appSettingDefaults["targets.fr"]) as Record<string, Record<string, number>>;
    expect(keysOf(checkField(field("targets.fr"), { ...targets, B1: { ...targets.B1, texts: -1 } }))).toEqual(["targets.fr.B1.texts"]);
    expect(checkField(field("prompt.writing_words"), { B1: [120, 60] })).toEqual([{ key: "prompt.writing_words.B1", message: "عدد اول نباید از دومی بیشتر باشد." }]);
    expect(keysOf(checkField(field("prompt.sentence_length"), { A1: [0, 10] }))).toEqual(["prompt.sentence_length.A1"]);
  });

  it("checks phonics lessons, with liaison for French only", () => {
    expect(checkField(field("phonics.lessons.fr"), [{ label: "liaison", kind: "liaison" }])).toEqual([]);
    expect(checkField(field("phonics.lessons.de"), [{ label: "Liaison", kind: "liaison" }])[0].message).toBe("«وصل شدن کلمه‌ها» فقط برای فرانسوی است.");
    expect(
      keysOf(
        checkField(field("phonics.lessons.fr"), [
          { label: "u و ou", kind: "contrast" },
          { label: " ", kind: "rule" },
        ]),
      ),
    ).toEqual(["phonics.lessons.fr.1"]);
    expect(checkField(field("phonics.lessons.fr"), [])[0].message).toBe("دست‌کم ۱ مورد لازم است.");
  });

  it("checks the length of texts", () => {
    expect(checkField(field("coming_soon_fa.fr"), "x".repeat(301))[0].message).toBe("حداکثر ۳۰۰ نویسه.");
    expect(checkField(field("coming_soon_fa.fr"), "")).toEqual([]);
  });

  it("finds a field again from its log row, with its language in the title", () => {
    for (const item of generalFields) {
      const target = logTarget(item);
      expect(fieldOfLog(target.entity, target.entityId)?.id).toBe(item.id);
    }
    expect(logTarget(field("coming_soon_fa.de"))).toEqual({ entity: "language_text", entityId: "de:coming_soon_fa" });
    expect(fieldTitle(field("targets.de") as GeneralField)).toBe("تعداد هدف هر سطح (آلمانی)");
  });
});
