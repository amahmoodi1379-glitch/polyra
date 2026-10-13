import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchReport, createBatch, submitAnswer } from "@/server/content/batches";
import { contentStatus } from "@/server/content/status";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const example = (language: string) => JSON.parse(readFileSync(join(process.cwd(), `prompts/v1/examples/P-F.${language}.json`), "utf8"));
const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

async function words(rows: [string, "noun" | "verb", string][]) {
  await testDb.word.createMany({
    data: rows.map(([code, pos, level], index) => ({ language: "fr", code, lemma: code, pos, level, meaning_fa: "معنی", intro_order: index + 1 })),
  });
}

async function phraseBatch(level?: string) {
  const made = await createBatch({ slug: "phrases", language: "fr", adminId: 1, options: { level } });
  if (!("id" in made)) throw new Error(made.nothing);
  return testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
}

/** A1 has no phrase target here, so A2 comes first. */
async function a2First() {
  const targets = { A1: { phrases: 0 }, A2: { phrases: 100 }, B1: { phrases: 150 }, B2: { phrases: 200 } };
  await testDb.appSetting.create({ data: { key: "targets.fr", value: targets } });
}

describe("phrase lists (P-F, PRD §5.1, §14.5)", () => {
  it("asks for one level's phrases and makes each a draft word after its last part", async () => {
    await a2First();
    await words([
      ["avoir", "verb", "A1"],
      ["faire", "verb", "A1"],
      ["prendre", "verb", "A1"],
      ["besoin", "noun", "A2"],
      ["décision", "noun", "A2"],
      ["course", "noun", "A2"],
      ["marché", "noun", "A2"],
    ]);
    expect((await contentStatus("fr")).phrases).toEqual({ state: "ready", level: "A2", count: 100, goal: 100 });
    const batch = await phraseBatch();
    expect(batch.prompt_text).toContain("حدود 100 عبارت");
    expect(batch.prompt_text).toContain("avoir | verb\n");
    expect(batch.prompt_text).not.toContain("avoir | verb | معنی");
    expect(batch.prompt_text).toContain('"level": "A2"');
    expect(batch.prompt_text).not.toContain("⟦");
    // A2 has an open batch now; B1 has no words yet.
    expect((await contentStatus("fr")).phrases).toEqual({ state: "needsWords", level: "B1" });

    expect(await submitAnswer(batch.id, [fence(example("fr"))], "answer")).toEqual({ state: "imported", rejected: 0 });
    const made = await testDb.word.findMany({ where: { pos: "phrase" }, orderBy: { id: "asc" } });
    expect(made.map((word) => [word.code, word.level, word.parts, word.meaning_fa, word.status])).toEqual([
      ["avoir besoin de", "A2", ["avoir", "besoin"], null, "draft"],
      ["prendre une décision", "A2", ["prendre", "décision"], null, "draft"],
      ["faire les courses", "A2", ["faire", "course"], null, "draft"],
    ]);
    const order = await testDb.word.findMany({ where: { level: "A2" }, orderBy: { intro_order: "asc" }, select: { code: true } });
    expect(order.map((word) => word.code)).toEqual([
      "besoin",
      "avoir besoin de",
      "décision",
      "prendre une décision",
      "course",
      "faire les courses",
      "marché",
    ]);

    // The next P-W batch completes them, with their parts in the list.
    const words2 = await createBatch({ slug: "words", language: "fr", adminId: 1, options: { level: "A2" } });
    if (!("id" in words2)) throw new Error(words2.nothing);
    const prompt = (await testDb.importBatch.findUniqueOrThrow({ where: { id: words2.id } })).prompt_text;
    expect(prompt).toContain("avoir besoin de | phrase | no_card=false | parts=avoir, besoin");
  });

  it("rejects single words, unknown parts and other levels, and skips phrases already in the list", async () => {
    await a2First();
    await words([
      ["avoir", "verb", "A1"],
      ["besoin", "noun", "A2"],
      ["faim", "noun", "A2"],
    ]);
    await testDb.word.create({ data: { language: "fr", code: "avoir faim", lemma: "avoir faim", pos: "phrase", level: "A2", parts: ["avoir", "faim"] } });
    const batch = await phraseBatch();
    const answer = {
      phrases: [
        { lemma: "avoir besoin de", parts: ["avoir", "besoin"], level: "A2" },
        { lemma: "Avoir  faim", parts: ["avoir", "faim"], level: "A2" },
        { lemma: "besoin", parts: ["besoin"], level: "A2" },
        { lemma: "prendre une décision", parts: ["prendre", "décision"], level: "A2" },
        { lemma: "avoir raison", parts: ["avoir"], level: "B1" },
        { lemma: "avoir besoin de", parts: ["avoir", "besoin"], level: "A2" },
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 4 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected.map((item) => [item.label, item.problems.map((found) => found.key)])).toEqual([
      ["besoin", ["notPhrase"]],
      ["prendre une décision", ["partsUnknown"]],
      ["avoir raison", ["levelMismatch"]],
      ["avoir besoin de", ["repeatedInAnswer"]],
    ]);
    expect(report.added).toBe(1);
    expect(report.skipped).toBe(1);
  });
});
