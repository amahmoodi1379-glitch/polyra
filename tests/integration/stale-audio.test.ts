import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoStatus, loadDemo } from "@/server/content/demo";
import { afterSentenceChange } from "@/server/content/library/edit/sentences";
import { loadContent } from "@/server/learn/content";
import { resetDb, testDb } from "./db";

/**
 * T48, rewritten for the phone's voice (DECISIONS.md, 13 October 2026): a published sentence whose text
 * is edited keeps its place in the app. Its teacher's file goes stale and is never played again; until
 * a new file comes the phone's voice reads the new text, so the sentence stays in use.
 */

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
}, 120_000);

afterAll(() => testDb.$disconnect());

describe("T48: an edited sentence with a teacher's file (PRD §13.7, §13.8)", () => {
  it("the stale file is not played; the phone's voice reads the new text and the sound exercises stay", async () => {
    expect((await demoStatus()).loaded).toBe(true);
    const row = await testDb.sentence.findFirstOrThrow({ where: { language: "fr", status: "approved" }, orderBy: { id: "asc" } });
    const asset = await testDb.audioAsset.create({ data: { kind: "sentence", url: "test://sentence.mp3", source: "human", duration_ms: 1500, listened_at: new Date() } });
    await testDb.sentence.update({ where: { id: row.id }, data: { human_audio_id: asset.id } });

    const before = await loadContent("fr", "tester");
    expect(before.sentences.get(row.id)!.speak).toMatchObject({ text: row.tts_text ?? row.text, url: "test://sentence.mp3" });

    // The teacher changes the text (the panel's form runs the same step after its own checks).
    const text = `${row.text.replace(/[.!?]+$/, "")} !`;
    await testDb.$transaction(async (tx) => {
      await tx.sentence.update({ where: { id: row.id }, data: { text, tts_text: null } });
      await afterSentenceChange(tx, 1, { id: row.id, language: "fr", audio_id: row.audio_id, human_audio_id: asset.id }, { textChanged: true, ttsChanged: false });
    });
    expect((await testDb.audioAsset.findUniqueOrThrow({ where: { id: asset.id } })).stale).toBe(true);

    const after = await loadContent("fr", "tester");
    // Still in the bank, so its exercises and drills keep coming; only the voice changed.
    expect(after.sentences.get(row.id)!.speak).toEqual({ text, lang: "fr", url: null });

  });
});
