import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchReport, createBatch, qaPrompt, submitAnswer } from "@/server/content/batches";
import { contentStatus } from "@/server/content/status";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const example = (language: string) => JSON.parse(readFileSync(join(process.cwd(), `prompts/v1/examples/P-T.${language}.json`), "utf8"));
const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/** The words of the French example, then fillers: `count` A1 words in teaching order. */
const exampleWords = ["bonjour", "madame", "je", "vouloir", "un", "café", "s'il vous plaît", "petit", "non", "grand", "avec", "du", "lait"];
const moreWords = ["d'accord", "ce", "être", "euro", "voilà", "merci", "au revoir", "bon", "journée"];

async function words(language: string, level: string, count: number, from = 0) {
  const codes = [...exampleWords, ...moreWords];
  await testDb.word.createMany({
    data: Array.from({ length: count }, (_, k) => {
      const index = from + k;
      const code = level === "A1" && index < codes.length ? codes[index] : `${level.toLowerCase()}-mot-${index}`;
      return { language, code, lemma: code, pos: "noun" as const, level, meaning_fa: "معنی", intro_order: index + 1 };
    }),
  });
}

async function unit(language: string, level: string) {
  await testDb.grammarUnit.create({ data: { language, unit_code: `${language}-${level.toLowerCase()}-present`, title_fa: "زمان حال", level, order_no: 1 } });
}

async function textBatch(language: "fr" | "de", level?: string) {
  const made = await createBatch({ slug: "texts", language, adminId: 1, options: { level } });
  if (!("id" in made)) throw new Error(made.nothing);
  return testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
}

describe("texts with questions (P-T, PRD §7, §14.3)", () => {
  it("makes the first A1 texts from the first 40 words and imports a dialogue with its four question sets", async () => {
    await words("fr", "A1", 45);
    expect((await contentStatus("fr")).texts).toEqual({ state: "needsUnits", level: "A1" });
    await unit("fr", "A1");
    expect((await contentStatus("fr")).texts).toEqual({ state: "ready", level: "A1", band: 1, size: 3, left: 40, goal: 40 });

    const batch = await textBatch("fr");
    expect(batch.prompt_text).toContain("رده (band): 1 | طول هر متن: 30 تا 40 کلمه");
    expect(batch.prompt_text).toContain("fr-a1-t001 | dialogue | دیالوگ دونفره (گفتگو) | زندگی روزمره | false");
    expect(batch.prompt_text).toContain("fr-a1-t003 | dialogue | دیالوگ دونفره (گفتگو) | غذا و رستوران | false");
    expect(batch.prompt_text).toContain("نوع‌های مجاز در reading: mcq، tf، order، match، find");
    expect(batch.prompt_text).toContain("نوع‌های مجاز در listening: mcq، tf، order، dict، num");
    expect(batch.prompt_text).toContain("هر مجموعه بین 2 و 8 سؤال.");
    // Only the first 40 words of the teaching order.
    expect(batch.prompt_text).toContain("a1-mot-39 | noun");
    expect(batch.prompt_text).not.toContain("a1-mot-40 | noun");
    expect(batch.prompt_text).not.toContain("⟦");
    // The next 7 texts need the first 100 words.
    expect((await contentStatus("fr")).texts).toEqual({ state: "needsWords", level: "A1", count: 100 });

    expect(await submitAnswer(batch.id, [fence(example("fr"))], "answer")).toEqual({ state: "imported", rejected: 0 });
    const text = await testDb.text.findFirstOrThrow({ include: { questions: { orderBy: [{ track: "asc" }, { set: "asc" }, { order_no: "asc" }] } } });
    const lait = await testDb.word.findFirstOrThrow({ where: { code: "lait" } });
    expect(text).toEqual(
      expect.objectContaining({ code: "fr-a1-t001", level: "A1", band: 1, kind: "dialogue", title: "Au café", word_count: 32, placement_ok: false }),
    );
    expect(text.speakers).toEqual(["A", "B", "A", "B", "A", "B", "A"]);
    expect(text.sentence_ids).toHaveLength(7);
    expect(text.key_word_ids).toEqual([lait.id]);
    expect(text.questions.map((row) => `${row.track} ${row.set}${row.order_no} ${row.type}`)).toEqual([
      "reading A1 mcq",
      "reading A2 find",
      "reading B1 tf",
      "reading B2 order",
      "listening A1 num",
      "listening A2 mcq",
      "listening B1 dict",
      "listening B2 tf",
    ]);
    expect(text.questions[0].payload).toEqual({
      prompt: "خانم چه قهوه‌ای می‌خواهد؟",
      options: ["یک قهوه کوچک", "یک قهوه بزرگ با شیر", "یک قهوه بزرگ بدون شیر", "دو قهوه کوچک"],
      correct: 1,
    });
    expect(text.questions[0].explanation_fa).toContain("Non, un grand café");
    // "3" is a number, not a word: the sentence keeps it as its own row.
    const price = await testDb.sentence.findFirstOrThrow({ where: { text: "D'accord. C'est 3 euros." }, include: { words: true } });
    expect(price.tts_text).toBe("D'accord. C'est trois euros.");
    expect(price.words.find((row) => row.surface === "3")?.kind).toBe("number");
    expect(qaPrompt(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))).toContain('"texts"');
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.warnings.filter((flag) => flag.problem.key === "notReturned").map((flag) => flag.label)).toEqual(["fr-a1-t002", "fr-a1-t003"]);

    // The two texts the chatbot did not send are offered again.
    await words("fr", "A1", 60, 45);
    expect((await contentStatus("fr")).texts).toEqual({ state: "ready", level: "A1", band: 1, size: 2, left: 39, goal: 40 });
  });

  it("rejects a text whose length, speakers or questions break the rules, and takes the fixed one", async () => {
    await words("fr", "A1", 40);
    await unit("fr", "A1");
    const batch = await textBatch("fr");
    const answer = example("fr");
    const text = answer.texts[0];
    text.sentences = text.sentences.slice(0, 6);
    text.sentences[1].speaker = null;
    const { reading, listening } = text.question_sets;
    reading.A[0].options = reading.A[0].options.slice(0, 3);
    reading.B[1].correct_order = [3, 1, 1, 0];
    reading.B.push({ type: "cloze", prompt: "…", text_with_gaps: "Un {{1}} café", bank: ["petit", "grand"], answers: ["petit"] });
    listening.A[1] = { ...listening.B[1] };
    listening.B[0].sentence = 4;
    text.key_words.push("bonjour", "chien");

    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected[0].problems.map((found) => [found.key, found.vars?.field ?? ""])).toEqual([
      ["speakers", ""],
      ["textLength", ""],
      ["optionsCount", "question_sets.reading.A[0].options"],
      ["orderInvalid", "question_sets.reading.B[1].items"],
      ["questionType", "question_sets.reading.B[2]"],
      ["dictNumber", "question_sets.listening.B[0].sentence"],
      ["questionRepeat", ""],
    ]);
    expect(await testDb.text.count()).toBe(0);

    const fixed = example("fr");
    fixed.texts[0].key_words.push("bonjour", "chien");
    expect(await submitAnswer(batch.id, [fence(fixed)], "fix")).toEqual({ state: "imported", rejected: 0 });
    const after = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    // A key word that is not in the list is dropped with a warning; one in the list is kept.
    expect(after.warnings.map((flag) => flag.problem)).toContainEqual({ key: "keyWordUnknown", vars: { code: "chien" } });
    expect((await testDb.text.findFirstOrThrow()).key_word_ids).toHaveLength(2);
  });

  it("refuses a text the batch did not ask for and a text already approved", async () => {
    await words("de", "A1", 40);
    await unit("de", "A1");
    const batch = await textBatch("de");
    const answer = example("de");
    const other = structuredClone(answer.texts[0]);
    other.code = "de-a1-t099";
    answer.texts.push(other);
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected[0].problems).toEqual([{ key: "textNotPlanned", vars: { code: "de-a1-t099", codes: "de-a1-t001، de-a1-t002، de-a1-t003" } }]);
    // German: "4 Euro 50" stays out of the dictation, the dialogue keeps its two speakers.
    const text = await testDb.text.findFirstOrThrow({ include: { questions: true } });
    expect(text.word_count).toBe(32);
    expect(text.questions).toHaveLength(8);

    await testDb.text.update({ where: { id: text.id }, data: { status: "approved" } });
    expect(await submitAnswer(batch.id, [fence(example("de"))], "fix")).toEqual({ state: "imported", rejected: 1 });
    const locked = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(locked.rejected.at(-1)?.problems).toEqual([{ key: "locked", vars: { code: "de-a1-t001" } }]);
  });

  it("alternates the two A2 bands and marks the first texts of a level for placement", async () => {
    const targets = { A1: { texts: 0 }, A2: { texts: 120 }, B1: { texts: 100 }, B2: { texts: 80 } };
    await testDb.appSetting.create({ data: { key: "targets.fr", value: targets } });
    await words("fr", "A2", 5);
    await unit("fr", "A2");

    const first = await textBatch("fr");
    const firstTexts = (first.params as { texts: { code: string; band: number; kind: string; placement_ok: boolean }[] }).texts;
    expect(firstTexts.map((spec) => [spec.code, spec.band, spec.kind, spec.placement_ok])).toEqual([
      ["fr-a2-t001", 1, "dialogue", true],
      ["fr-a2-t002", 1, "voice_message", true],
      ["fr-a2-t003", 1, "announcement", true],
    ]);
    expect(first.prompt_text).toContain("مجموعه A هر مسیر دست‌کم 4 سؤال دارد");

    // Band 1 has three texts now, so band 2 comes next, two at a time; one more placement text is left.
    expect((await contentStatus("fr")).texts).toEqual({ state: "ready", level: "A2", band: 2, size: 2, left: 117, goal: 120 });
    const second = await textBatch("fr");
    const secondTexts = (second.params as { texts: { code: string; band: number; kind: string; placement_ok: boolean }[] }).texts;
    expect(secondTexts.map((spec) => [spec.code, spec.band, spec.kind, spec.placement_ok])).toEqual([
      ["fr-a2-t004", 2, "phone_call", true],
      ["fr-a2-t005", 2, "email", false],
    ]);
    expect(second.prompt_text).toContain("طول هر متن: 60 تا 120 کلمه");
    expect(second.prompt_text).toContain("نوع‌های مجاز در reading: mcq، tf، order، match، find، cloze");
  });
});
