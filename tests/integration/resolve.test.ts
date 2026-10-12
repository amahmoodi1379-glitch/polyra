import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pos } from "@/generated/prisma/client";
import { openCounts, openItems, resolveCandidate, resolveDuplicate, resolveSuspect, searchVocabulary } from "@/server/content/resolve";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

type WordFields = { language?: string; lemma?: string; pos?: Pos; level?: string; meaning_fa?: string | null; plural?: string };

async function word(code: string, fields: WordFields = {}) {
  return testDb.word.create({ data: { language: "fr", code, lemma: code, pos: "noun", level: "A1", meaning_fa: "معنی", ...fields } });
}

type Row = { surface: string; word_id?: number | null; code_given?: string; candidate_reason?: "missing" | "name_matches_word"; suspect?: boolean; kind?: "word" | "name" };

/** A sentence with its token rows; spans are found from the surfaces. */
async function sentence(text: string, rows: Row[], options: { level?: string; language?: string; batch?: number } = {}) {
  let from = 0;
  return testDb.sentence.create({
    data: {
      language: options.language ?? "fr",
      text,
      translation_fa: "ترجمه",
      text_hash: text,
      level: options.level ?? "A1",
      import_batch_id: options.batch ?? null,
      words: {
        create: rows.map((row, position) => {
          const start = text.indexOf(row.surface, from);
          from = start + row.surface.length;
          return { position, spans: [[start, from]], kind: row.kind ?? "word", word_id: row.word_id ?? null, ...row, meaning_fa_ctx: "معنی" };
        }),
      },
    },
  });
}

describe("candidates (PRD §13.9)", () => {
  it("groups one missing word across sentences; adding it makes a draft word the next word batch fills", async () => {
    const je = await word("je", { pos: "pron" });
    await testDb.frequencyItem.create({ data: { language: "fr", rank: 812, lemma: "fromage" } });
    await sentence("Je mange du fromage.", [{ surface: "Je", word_id: je.id }, { surface: "fromage", code_given: "fromage", candidate_reason: "missing" }], { level: "A2" });
    await sentence("Le fromage est bon.", [{ surface: "fromage", code_given: "fromage", candidate_reason: "missing" }]);

    const { candidates } = await openItems("fr");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ reason: "missing", word: "fromage", sentences: 2, level: "A2" });
    expect(candidates[0].sentence.spans).toEqual([[12, 19]]);
    // Counted the way the page shows them: one word in two sentences is one item.
    expect(await openCounts("fr")).toEqual({ candidates: 1, suspects: 0, duplicates: 0 });

    expect(await resolveCandidate("fr", candidates[0].key, { type: "add", lemma: "fromage", pos: "noun", level: "A2" })).toBe(true);
    const added = await testDb.word.findFirstOrThrow({ where: { lemma: "fromage" } });
    expect(added).toMatchObject({ code: "fromage", status: "draft", meaning_fa: null, level: "A2", frequency_rank: 812, intro_order: 1 });
    expect(await testDb.sentenceWord.count({ where: { word_id: added.id, candidate_reason: null } })).toBe(2);
    expect((await openItems("fr")).candidates).toHaveLength(0);
    // Settled already: a second click changes nothing.
    expect(await resolveCandidate("fr", candidates[0].key, { type: "name" })).toBe(false);
  });

  it("links a candidate to a chosen word and remembers the form, or keeps it as a name", async () => {
    const aller = await word("aller", { pos: "verb" });
    await sentence("Tu vas bien.", [{ surface: "vas", code_given: "vas", candidate_reason: "missing" }]);
    await sentence("Paulo arrive.", [{ surface: "Paulo", code_given: "paulo", candidate_reason: "missing" }]);
    await sentence("Il court vite.", [{ surface: "court", code_given: "courir-verb", candidate_reason: "missing" }]);
    const [vas, paulo, court] = (await openItems("fr")).candidates;
    // The page offers the lemma and word type the chatbot's code names, never the code itself.
    expect(court).toMatchObject({ word: "courir", pos: "verb" });
    expect(vas).toMatchObject({ word: "vas", pos: null });

    expect(await resolveCandidate("fr", vas.key, { type: "choose", wordId: aller.id })).toBe(true);
    expect(await testDb.sentenceWord.findFirstOrThrow({ where: { surface: "vas" } })).toMatchObject({ word_id: aller.id, kind: "word" });
    expect(await testDb.formException.findMany({ select: { word_id: true, surface: true } })).toEqual([{ word_id: aller.id, surface: "vas" }]);

    expect(await resolveCandidate("fr", paulo.key, { type: "name" })).toBe(true);
    expect(await testDb.sentenceWord.findFirstOrThrow({ where: { surface: "Paulo" } })).toMatchObject({ kind: "name", word_id: null, candidate_reason: null });
  });

  it("turns a name that equals a vocabulary word into that word (German nouns are capitalised)", async () => {
    const tisch = await word("Tisch", { language: "de", plural: "Tische" });
    await sentence("Die Tische sind neu.", [{ surface: "Tische", kind: "name", candidate_reason: "name_matches_word" }], { language: "de" });
    const [group] = (await openItems("de")).candidates;
    expect(group).toMatchObject({ reason: "name_matches_word", match: { id: tisch.id } });
    expect(await resolveCandidate("de", group.key, { type: "listed" })).toBe(true);
    expect(await testDb.sentenceWord.findFirstOrThrow({ where: { surface: "Tische" } })).toMatchObject({ kind: "word", word_id: tisch.id });
  });
});

describe("suspect mappings (PRD §14.1 rule 6)", () => {
  it("confirming stores the form so the check never asks again; choosing moves the rows to another word", async () => {
    const oeil = await word("œil", { plural: "yeux" });
    const etre = await word("être", { pos: "verb" });
    const ete = await word("été");
    await sentence("Il a les Yeux bleus.", [{ surface: "Yeux", word_id: oeil.id, suspect: true }]);
    await sentence("Ses yeux sont fermés.", [{ surface: "yeux", word_id: oeil.id, suspect: true }]);
    await sentence("Il a été là.", [{ surface: "été", word_id: ete.id, suspect: true }]);

    const { suspects } = await openItems("fr");
    expect(suspects.map((group) => [group.surface, group.word.code, group.sentences])).toEqual([
      ["Yeux", "œil", 2],
      ["été", "été", 1],
    ]);
    expect(await resolveSuspect("fr", suspects[0].key, { type: "confirm" })).toBe(true);
    expect(await testDb.sentenceWord.count({ where: { word_id: oeil.id, suspect: false } })).toBe(2);
    expect(await testDb.formException.findFirst({ where: { word_id: oeil.id } })).toMatchObject({ surface: "yeux" });

    expect(await resolveSuspect("fr", suspects[1].key, { type: "choose", wordId: etre.id })).toBe(true);
    expect(await testDb.sentenceWord.findFirstOrThrow({ where: { surface: "été" } })).toMatchObject({ word_id: etre.id, suspect: false });
    expect(await openCounts("fr")).toEqual({ candidates: 0, suspects: 0, duplicates: 0 });
  });
});

describe("duplicate words (PRD §13.9)", () => {
  async function pair() {
    const base = await word("glace-noun", { lemma: "glace", meaning_fa: "بستنی" });
    const dup = await testDb.word.create({
      data: { language: "fr", code: "glace", lemma: "glace", pos: "noun", level: "A1", meaning_fa: "آینه", dup_of_id: base.id, import_batch_id: 7 },
    });
    return { base, dup };
  }

  it("shows the pair and makes a new sense with the code glace-2", async () => {
    const { base, dup } = await pair();
    const { duplicates } = await openItems("fr");
    expect(duplicates).toEqual([{ word: expect.objectContaining({ id: dup.id, meaning_fa: "آینه" }), existing: expect.objectContaining({ id: base.id, meaning_fa: "بستنی" }) }]);
    expect(await openCounts("fr", 7)).toEqual({ candidates: 0, suspects: 0, duplicates: 1 });

    expect(await resolveDuplicate("fr", dup.id, true)).toBe(true);
    expect(await testDb.word.findUniqueOrThrow({ where: { id: dup.id } })).toMatchObject({ code: "glace-2", sense_of: "glace-noun", dup_of_id: null });
  });

  it("retires a real duplicate and moves its sentences to the existing word", async () => {
    const { base, dup } = await pair();
    const s = await sentence("La glace fond.", [{ surface: "glace", word_id: dup.id }]);
    await testDb.sentenceTarget.create({
      data: { language: "fr", sentence_id: s.id, target_type: "word", target_id: dup.id, marked_text: "La {{glace}} fond.", accepted: ["glace"], distractors: ["a", "b", "c"] },
    });
    expect(await resolveDuplicate("fr", dup.id, false)).toBe(true);
    expect(await testDb.word.findUniqueOrThrow({ where: { id: dup.id } })).toMatchObject({ status: "retired", dup_of_id: null });
    expect(await testDb.sentenceWord.findFirstOrThrow({ where: { sentence_id: s.id } })).toMatchObject({ word_id: base.id });
    expect(await testDb.sentenceTarget.findFirstOrThrow({ where: { sentence_id: s.id } })).toMatchObject({ target_id: base.id });
    expect((await openItems("fr")).duplicates).toEqual([]);
  });
});

it("searches the vocabulary by lemma, code or meaning, exact matches first", async () => {
  await word("passer", { pos: "verb", meaning_fa: "گذشتن" });
  await word("pas", { pos: "adv", meaning_fa: "نه" });
  await word("passé", { pos: "adj", meaning_fa: "گذشته" });
  const found = (await searchVocabulary("fr", "pas")).map((row) => row.code);
  expect(found[0]).toBe("pas");
  expect(found.slice(1).sort()).toEqual(["passer", "passé"]);
  expect((await searchVocabulary("fr", "گذشت")).map((found) => found.code).sort()).toEqual(["passer", "passé"]);
  expect(await searchVocabulary("fr", "  ")).toEqual([]);
});
