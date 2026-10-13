import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { t, type MessageKey } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { listLog } from "@/server/content/library/history";
import { languageState, levelChecklist, setLanguageLive, setLevelRelease } from "@/server/content/publish/levels";
import { previewPublish, publishReady } from "@/server/content/publish/run";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const ADMIN = 1;
const why = (key: string, vars?: Record<string, string | number>) => isolateLatin(t(`admin.publish.reasons.${key}` as MessageKey, vars));
const lastLog = () => testDb.adminLog.findFirstOrThrow({ orderBy: { id: "desc" } });

/** A recording; heard by a teacher unless said otherwise. */
async function audio(extra: { stale?: boolean; listened_at?: Date | null; kind?: "word" | "sentence" | "text" | "phonics" } = {}) {
  return (await testDb.audioAsset.create({ data: { kind: "word", url: "test://audio.mp3", source: "tts", listened_at: new Date(), ...extra } })).id;
}

async function word(code: string, extra: Record<string, unknown> = {}) {
  return testDb.word.create({
    data: { language: "fr", code, lemma: code, pos: "noun", gender: "m", level: "A1", meaning_fa: "معنی", status: "approved", audio_id: await audio(), ...extra },
  });
}

async function sentence(text: string, wordIds: number[], extra: Record<string, unknown> = {}) {
  return testDb.sentence.create({
    data: {
      language: "fr",
      text,
      translation_fa: "ترجمه",
      text_hash: text,
      level: "A1",
      status: "approved",
      audio_id: await audio({ kind: "sentence" }),
      words: { create: wordIds.map((word_id, position) => ({ word_id, surface: "x", spans: [], position })) },
      ...extra,
    },
  });
}

/** `count` approved sentences that use a word or unit and practise it. */
async function practice(target: { id: number; code?: string; unit_code?: string }, count: number, type: "word" | "grammar" = "word", wordIds?: number[]) {
  const made = [];
  for (let index = 0; index < count; index++) {
    const row = await sentence(`${target.code ?? target.unit_code} ${index}.`, wordIds ?? [target.id]);
    await testDb.sentenceTarget.create({
      data: { language: "fr", sentence_id: row.id, target_type: type, target_id: target.id, marked_text: "x", accepted: [], distractors: [] },
    });
    made.push(row);
  }
  return made;
}

/** A band 1 text with whole-text audio and two questions in each track and set. */
async function text(sentenceIds: number[], extra: Record<string, unknown> = {}) {
  const row = await testDb.text.create({
    data: {
      language: "fr",
      code: `fr-a1-t${sentenceIds[0]}`,
      level: "A1",
      band: 1,
      kind: "dialogue",
      title: "Au café",
      sentence_ids: sentenceIds,
      audio_id: await audio({ kind: "text" }),
      sentence_offsets_ms: sentenceIds.map((_, index) => index * 1000),
      status: "approved",
      ...extra,
    },
  });
  for (const track of ["reading", "listening"] as const) {
    for (const set of ["A", "B"] as const) {
      for (const order_no of [1, 2]) {
        await testDb.question.create({ data: { language: "fr", text_id: row.id, track, set, order_no, type: "mcq", payload: {} } });
      }
    }
  }
  return row;
}

describe("publish conditions (PRD §13.5)", () => {
  it("names what each word and sentence still lacks", async () => {
    const pain = await word("pain");
    await practice(pain, 5);
    const eau = await word("eau", { gender: null, audio_id: null });
    await practice(eau, 2);
    const lait = await word("lait", { audio_id: await audio({ stale: true }) });
    await practice(lait, 5);
    const oui = await word("oui", { pos: "adv", gender: null, no_card: true });
    const chat = await word("chat", { status: "draft" });
    const unready = await sentence("Le chat.", [chat.id]);
    const silent = await sentence("Le pain.", [pain.id], { audio_id: null, translation_fa: " " });

    const { ready, blocked } = await previewPublish("fr");
    expect(ready.filter((item) => item.slug === "words").map((item) => item.id)).toEqual([pain.id, oui.id]);
    expect(ready.filter((item) => item.slug === "sentences")).toHaveLength(12);
    expect(blocked.map((item) => [item.id, item.reasons])).toEqual([
      [eau.id, [why("noGender"), why("noAudio"), why("wordTargets", { count: 2, min: 5 })]],
      [lait.id, [why("staleAudio")]],
      [unready.id, [why("wordsNotReady", { words: "chat" })]],
      [silent.id, [why("noTranslation"), why("noAudio")]],
    ]);
  });

  it("checks units, tables, texts and phonics lessons", async () => {
    const unit = await testDb.grammarUnit.create({ data: { language: "fr", unit_code: "fr-a1-present", title_fa: "زمان حال", level: "A1", status: "approved" } });
    const hard = await word("néanmoins", { level: "B1" });
    await practice(unit, 1, "grammar", [hard.id]);

    const etre = await word("être", { pos: "verb", gender: null, status: "draft" });
    const forms = { je: "suis", tu: "es", il_elle_on: "est", nous: "sommes", vous: "êtes", ils_elles: "" };
    const table = await testDb.conjugationTable.create({ data: { language: "fr", word_id: etre.id, tense: "présent", forms, unit_code: "fr-a1-etre", status: "approved" } });

    const lines = await Promise.all(["Bonjour.", "Un café."].map((line) => sentence(line, [])));
    const cafe = await text(
      lines.map((line) => line.id),
      { sentence_offsets_ms: [0] },
    );
    await testDb.question.deleteMany({ where: { text_id: cafe.id, track: "listening", set: "A", order_no: 2 } });

    const lesson = await testDb.phonicsLesson.create({
      data: {
        language: "fr",
        kind: "contrast",
        sound_label: "u و ou",
        tip_fa: "نکته",
        status: "approved",
        example_words: [{ text: "rue", audio_id: null }],
        minimal_pairs: [{ a: "rue", b: "roue", a_audio_id: await audio(), b_audio_id: await audio({ stale: true }) }],
      },
    });

    const { blocked } = await previewPublish("fr");
    const reasons = Object.fromEntries(blocked.map((item) => [`${item.slug}:${item.id}`, item.reasons]));
    expect(reasons[`units:${unit.id}`]).toEqual([
      why("noLesson"),
      why("noRule"),
      why("examples", { count: 0 }),
      why("unitTargets", { count: 1, min: 30 }),
      why("wordsAboveLevel", { level: "A1", words: "néanmoins" }),
    ]);
    expect(reasons[`tables:${table.id}`]).toEqual([why("emptyForms", { count: 1 }), why("verbNotReady", { verb: "être" }), why("unitNotReady", { units: "fr-a1-etre" })]);
    expect(reasons[`texts:${cafe.id}`]).toEqual([why("textAudio"), why("questions", { track: t("admin.publish.tracks.listening"), set: "A", count: 1, min: 2, max: 8 })]);
    expect(reasons[`phonics:${lesson.id}`]).toEqual([why("recordingsMissing", { count: 1 }), why("recordingsStale", { count: 1 })]);
  });
});

describe("publishing (PRD §13.5)", () => {
  it("publishes the ready items with their sentences, questions and targets, in one log row", async () => {
    const pain = await word("pain");
    const painSentences = await practice(pain, 5);
    const eau = await word("eau", { gender: null });
    await practice(eau, 5);
    const lines = await Promise.all(["Bonjour.", "Un café."].map((line) => sentence(line, [], { status: "draft" })));
    const cafe = await text(lines.map((line) => line.id));

    const result = await publishReady("fr", ADMIN);
    expect(result).toEqual({ published: 12, bySlug: { words: 1, sentences: 10, texts: 1 }, blocked: 1 });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: eau.id } })).status).toBe("approved");
    expect(await testDb.sentence.count({ where: { id: { in: lines.map((line) => line.id) }, status: "published" } })).toBe(2);
    expect(await testDb.question.count({ where: { text_id: cafe.id, status: "published" } })).toBe(8);
    // Only the targets whose word went out too.
    const targets = await testDb.sentenceTarget.findMany({ where: { status: "published" }, select: { target_id: true } });
    expect(targets.map((row) => row.target_id)).toEqual(Array(5).fill(pain.id));

    const row = await lastLog();
    expect(row).toEqual(expect.objectContaining({ action: "publish", entity: "publish", entity_id: "fr", before: null }));
    expect(row.after).toEqual({
      items: { words: [pain.id], sentences: expect.arrayContaining(painSentences.map((item) => item.id)), texts: [cafe.id] },
      children: { sentences: 2, questions: 8, targets: 5 },
    });

    // Nothing new to publish: no second log row.
    expect(await publishReady("fr", ADMIN)).toEqual({ published: 0, bySlug: {}, blocked: 1 });
    expect((await lastLog()).id).toBe(row.id);

    const log = await listLog("publish", 1);
    expect(log.items).toHaveLength(1);
    expect(log.items[0]).toEqual(
      expect.objectContaining({ action: "publish", title: { text: t("admin.log.publish.title", { count: 12 }), voice: "fa" }, revert: "no", href: "/admin/publish?lang=fr" }),
    );
    expect(log.items[0].lines.map((line) => line.key)).toEqual(["words", "sentences", "texts", "children"]);
    expect(log.items[0].lines[0].note).toBe(t("admin.log.publish.items", { count: 1, list: isolateLatin("pain") }));
    // The publish row is not one of the items' own rows.
    expect((await listLog("words", 1)).items).toHaveLength(0);
  });
});

describe("opening levels and showing a language (PRD §13.5)", () => {
  async function publishedWord() {
    const pain = await word("pain");
    await practice(pain, 5);
    await publishReady("fr", ADMIN);
    return pain;
  }

  it("keeps a level closed until its blocking lines pass, and asks before warnings", async () => {
    expect(await setLevelRelease("fr", "A1", true, true, ADMIN)).toEqual({ state: "blocked", reason: "checklist" });
    const pain = await publishedWord();

    // A sentence of the level whose recording nobody has heard yet.
    const sentenceRow = await testDb.sentenceTarget.findFirstOrThrow({ where: { target_id: pain.id }, include: { sentence: true } });
    await testDb.audioAsset.update({ where: { id: sentenceRow.sentence.audio_id! }, data: { listened_at: null } });
    const lines = await levelChecklist("fr", "A1");
    expect(lines.map((line) => [line.key, line.kind, line.ok])).toEqual([
      ["published", "block", true],
      ["items", "block", true],
      ["open", "block", true],
      ["reports", "block", true],
      ["audio", "block", false],
      ["placement", "warn", false],
      ["counts", "warn", false],
    ]);
    expect(lines[4].details).toEqual([t("admin.publish.check.audio.sentences", { count: 1 })]);
    expect(await setLevelRelease("fr", "A1", true, true, ADMIN)).toEqual({ state: "blocked", reason: "checklist" });

    await testDb.audioAsset.update({ where: { id: sentenceRow.sentence.audio_id! }, data: { listened_at: new Date() } });
    await testDb.contentReport.create({ data: { item_type: "word", item_id: pain.id, reason: "audio", priority: "high" } });
    expect((await levelChecklist("fr", "A1")).find((line) => line.key === "reports")?.ok).toBe(false);
    await testDb.contentReport.updateMany({ data: { status: "fixed" } });

    expect(await setLevelRelease("fr", "A1", true, false, ADMIN)).toEqual({ state: "blocked", reason: "confirm" });
    expect(await setLevelRelease("fr", "A1", true, true, ADMIN)).toEqual({ state: "done" });
    expect(await lastLog()).toEqual(
      expect.objectContaining({ action: "release", entity: "level_release", entity_id: "fr:A1", before: { released: false }, after: { released: true } }),
    );
    const state = await languageState("fr");
    expect(state.firstOpen).toBe(true);
    expect(state.levels.map((level) => [level.level, Boolean(level.released), level.lines.length > 0])).toEqual([
      ["A1", true, true],
      ["A2", false, true],
      ["B1", false, false],
      ["B2", false, false],
    ]);
  });

  it("opens levels from the bottom, closes them from the top, and shows a language only with its first level", async () => {
    expect(await setLevelRelease("fr", "B1", true, true, ADMIN)).toEqual({ state: "blocked", reason: "lower" });
    expect(await setLevelRelease("fr", "C1", true, true, ADMIN)).toEqual({ state: "blocked", reason: "unknown" });
    expect(await setLanguageLive("fr", true, ADMIN)).toEqual({ state: "blocked", reason: "firstLevel" });

    await publishedWord();
    expect(await setLevelRelease("fr", "A1", true, true, ADMIN)).toEqual({ state: "done" });
    expect(await setLanguageLive("fr", true, ADMIN)).toEqual({ state: "done" });
    expect(await lastLog()).toEqual(expect.objectContaining({ action: "live", entity: "language", entity_id: "fr", after: { live: true } }));
    expect((await testDb.language.findUniqueOrThrow({ where: { code: "fr" } })).live).toBe(true);

    expect(await setLevelRelease("fr", "A1", false, false, ADMIN)).toEqual({ state: "blocked", reason: "live" });
    await testDb.levelRelease.create({ data: { language: "fr", level: "A2" } });
    expect(await setLevelRelease("fr", "A1", false, false, ADMIN)).toEqual({ state: "blocked", reason: "higher" });
    expect(await setLevelRelease("fr", "A2", false, false, ADMIN)).toEqual({ state: "done" });
    expect(await setLanguageLive("fr", false, ADMIN)).toEqual({ state: "done" });
    expect(await setLevelRelease("fr", "A1", false, false, ADMIN)).toEqual({ state: "done" });
    expect(await testDb.levelRelease.count()).toBe(0);

    const log = await listLog("publish", 1);
    expect(log.items.map((item) => item.title?.text)).toEqual([
      isolateLatin(t("admin.log.publish.levelClosed", { level: "A1" })),
      t("admin.log.publish.hidden", { language: t("common.languages.fr") }),
      isolateLatin(t("admin.log.publish.levelClosed", { level: "A2" })),
      t("admin.log.publish.shown", { language: t("common.languages.fr") }),
      isolateLatin(t("admin.log.publish.levelOpened", { level: "A1" })),
      t("admin.log.publish.title", { count: 6 }),
    ]);
    expect(log.items.every((item) => item.revert === "no")).toBe(true);
  });

  it("asks for every sentence recording up to A2, and a fifth of them from B1", async () => {
    for (const level of ["A2", "B1"]) {
      const verb = await word(`mot-${level}`, { level });
      const made = await practice(verb, 5);
      for (const row of made.slice(1)) await testDb.audioAsset.update({ where: { id: row.audio_id! }, data: { listened_at: null } });
    }
    await publishReady("fr", ADMIN);
    const audioOf = async (level: string) => (await levelChecklist("fr", level)).find((line) => line.key === "audio")!;
    expect((await audioOf("A2")).details).toEqual([t("admin.publish.check.audio.sentences", { count: 4 })]);
    expect((await audioOf("B1")).ok).toBe(true);
  });
});
