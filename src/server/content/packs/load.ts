import type { ImportBatch, Prisma, PromptKind } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { forgetContent } from "@/server/learn/content";
import { appSetting } from "@/server/settings/read";
import { answerRecords } from "../batches";
import { demoStatus, removeDemo } from "../demo";
import { conjugation } from "../kinds/conjugation";
import { dialogues } from "../kinds/dialogues";
import { grammar } from "../kinds/grammar";
import { phonics, type PlannedLesson } from "../kinds/phonics";
import { sentences } from "../kinds/sentences";
import { texts } from "../kinds/texts";
import type { ContentKind, Tx } from "../kinds/types";
import { unitList } from "../kinds/unit-list";
import { words } from "../kinds/words";
import type { LanguageCode } from "../languages";
import { librarySlugs, type LibrarySlug } from "../library/slugs";
import { fold } from "@/engine/tokens";
import { describeProblem } from "../problems";
import { publishReady } from "../publish/run";
import { mergeRound, type RoundResult } from "../report";
import { buildPack, hashOf, type Pack, type PackLevel } from "./build";

/**
 * Loads the content packs into the database at server start (owner, 18 Nov 2026: Claude writes the
 * content and it is published straight away; teachers edit and delete freely). Every item goes through
 * the panel's own importer, so it passes the same checks as any other content. Each item is loaded
 * once: `content_pack_item` remembers it, so an item a teacher deleted or changed is left alone. New
 * items in the files come in at the next start. Rows of this run are approved and then published when
 * their publish conditions hold; opening a level to learners stays the teacher's step (PRD §13.5).
 */

export const PACK_VERSION = "pack-1";
const PACK_MODEL = "Claude (content packs)";
const LOCK = 8_224_017; // pg_advisory_xact_lock key: one loader at a time
const SENTENCE_BATCH = 200;

export type LevelReport = { level: string; added: Record<string, number>; rejected: string[]; skipped: string[] };
export type LanguageReport = {
  language: LanguageCode;
  packErrors: number;
  levels: LevelReport[];
  published: number;
  blocked: number;
  demoRemoved: boolean;
};

type Ledger = Set<string>;
type Run = { tx: Tx; language: LanguageCode; adminId: number | null; batches: number[]; report: LevelReport; ledger: Ledger; loaded: { kind: string; key: string; hash: string }[] };

const ledgerKey = (kind: string, key: string) => `${kind}|${key}`;

async function newBatch(run: Run, kind: PromptKind, params: Record<string, unknown>): Promise<ImportBatch> {
  const batch = await run.tx.importBatch.create({
    data: {
      language: run.language,
      prompt_kind: kind,
      prompt_version: PACK_VERSION,
      model_name: PACK_MODEL,
      prompt_text: "بسته محتوای Claude (بدون پرامپت)",
      params: { ...params, summary: [] } as Prisma.InputJsonValue,
      created_by: run.adminId,
    },
  });
  run.batches.push(batch.id);
  return batch;
}

/** One answer through its importer; what it rejects is reported, never thrown. */
async function importAnswer(run: Run, kind: ContentKind, batch: ImportBatch, answer: Record<string, unknown>): Promise<RoundResult> {
  const content = answerRecords(kind, answer);
  if (!content) throw new Error(`Pack answer for ${kind.kind} has none of its keys`);
  const round = await kind.importRecords(run.tx, batch, content.records, content.parts, run.adminId);
  for (const item of round.rejected) run.report.rejected.push(`${kind.kind} ${item.label}: ${item.problems.map((problem) => describeProblem(problem, "chatbot")).join("; ")}`);
  if (round.candidates > 0) run.report.rejected.push(`${kind.kind}: ${round.candidates} unknown words (candidates)`);
  if (round.suspects > 0) run.report.rejected.push(`${kind.kind}: ${round.suspects} doubtful word mappings (suspects)`);
  await run.tx.importBatch.update({
    where: { id: batch.id },
    data: { state: "reviewed", raw_output: JSON.stringify(answer), report: { ...mergeRound(null, round, []), accepted: [], rejected: [] } as unknown as Prisma.InputJsonValue },
  });
  return round;
}

const accepted = (round: RoundResult) => new Set(round.accepted.map((item) => item.record));
const count = (run: Run, kind: string, n: number) => (run.report.added[kind] = (run.report.added[kind] ?? 0) + n);

/** Codes of the words in the database now (a word a teacher deleted is gone; its sentences wait). */
async function wordCodes(tx: Tx, language: string) {
  return new Set((await tx.word.findMany({ where: { language, status: { not: "retired" } }, select: { code: true } })).map((row) => row.code));
}
const tokenCodes = (tokens: { code: string | null }[]) => tokens.map((token) => token.code).filter((code): code is string => code !== null);

async function loadLevel(run: Run, level: PackLevel) {
  const { tx, language, ledger } = run;
  const fresh = (kind: string, key: string) => !ledger.has(ledgerKey(kind, key));
  const remember = (kind: string, key: string, value: unknown) => {
    run.loaded.push({ kind, key, hash: hashOf(value) });
    ledger.add(ledgerKey(kind, key));
  };

  // Grammar units first: words and tables point at them.
  const units = level.units.filter((unit) => fresh("unit", unit.listItem.unit_code));
  if (units.length > 0) {
    const answer = { units: units.map((unit) => unit.listItem), issues: [] };
    const round = await importAnswer(run, unitList, await newBatch(run, "P_U", { level: level.level }), answer);
    const ok = accepted(round);
    for (const unit of units) if (ok.has(unit.listItem)) remember("unit", unit.listItem.unit_code, unit.listItem);
    count(run, "units", ok.size);
  }

  const newWords = level.words.filter((item) => fresh("word", item.word.code));
  if (newWords.length > 0) {
    const round = await importAnswer(run, words, await newBatch(run, "P_W", { level: level.level, word_ids: [] }), { words: newWords.map((item) => item.word) });
    const ok = accepted(round);
    for (const item of newWords) if (ok.has(item.word)) remember("word", item.word.code, item.word);
    count(run, "words", ok.size);
  }

  let codes = await wordCodes(tx, language);
  const ids = new Map((await tx.word.findMany({ where: { language, code: { in: level.exceptions.map((item) => item.code) } }, select: { id: true, code: true } })).map((row) => [row.code, row.id]));
  for (const item of level.exceptions) {
    const key = `${item.code}|${item.surface}`;
    const wordId = ids.get(item.code);
    if (!fresh("exception", key) || !wordId) continue;
    await tx.formException.upsert({ where: { word_id_surface: { word_id: wordId, surface: item.surface } }, create: { word_id: wordId, surface: item.surface }, update: {} });
    remember("exception", key, item);
  }

  // Lessons of the units: only for a unit that is still there and whose sentences use words that are.
  const unitRows = new Map((await tx.grammarUnit.findMany({ where: { language, unit_code: { in: level.units.map((unit) => unit.listItem.unit_code) } }, select: { id: true, unit_code: true } })).map((row) => [row.unit_code, row.id]));
  for (const unit of level.units) {
    const code = unit.listItem.unit_code;
    const unitId = unitRows.get(code);
    if (!fresh("grammar", code)) continue;
    if (!unitId) {
      run.report.skipped.push(`grammar ${code}: the unit is not in the database`);
      continue;
    }
    type Tokens = { tokens: { code: string | null }[] };
    const answer = unit.answer as { unit: { example_sentences: Tokens[] }; targets: { sentence: Tokens }[]; translations: Tokens[] };
    const used = [...answer.unit.example_sentences, ...answer.targets.map((item) => item.sentence), ...answer.translations].flatMap((item) => tokenCodes(item.tokens));
    const missing = used.filter((item) => !codes.has(item));
    if (missing.length > 0) {
      run.report.skipped.push(`grammar ${code}: uses words not in the database (${[...new Set(missing)].join(", ")})`);
      continue;
    }
    const round = await importAnswer(run, grammar, await newBatch(run, "P_G", { level: level.level, unit_id: unitId, unit_code: code }), unit.answer);
    if (round.accepted.some((item) => item.part === "unit")) remember("grammar", code, unit.answer);
    count(run, "grammar targets", round.accepted.filter((item) => item.part === "targets").length);
  }

  const tables = level.tables.filter((table) => fresh("table", `${table.verb.word.code}|${table.tense}`) && codes.has(table.verb.word.code));
  if (tables.length > 0) {
    const unitsThere = new Set((await tx.grammarUnit.findMany({ where: { language }, select: { unit_code: true } })).map((row) => row.unit_code));
    const records = tables.filter((table) => unitsThere.has(table.unit_code)).map((table) => ({ verb: table.verb.word.code, tense: table.tense, unit_code: table.unit_code, forms: table.forms, accepted_variants: table.accepted_variants, review_card: table.review_card }));
    if (records.length > 0) {
      const round = await importAnswer(run, conjugation, await newBatch(run, "P_X", { level: level.level }), { tables: records });
      const ok = accepted(round);
      for (const record of records) if (ok.has(record)) remember("table", `${record.verb}|${record.tense}`, record);
      count(run, "tables", ok.size);
    }
  }

  codes = await wordCodes(tx, language);
  const waiting = level.sentences.filter((sentence) => fresh("sentence", sentence.text));
  const ready = waiting.filter((sentence) => [...tokenCodes(sentence.tokens), ...sentence.targets.map((target) => target.target)].every((code) => codes.has(code)));
  if (ready.length < waiting.length) run.report.skipped.push(`${waiting.length - ready.length} sentences use words not in the database`);
  for (let at = 0; at < ready.length; at += SENTENCE_BATCH) {
    const chunk = ready.slice(at, at + SENTENCE_BATCH);
    const targets = new Set(chunk.flatMap((sentence) => sentence.targets.map((target) => target.target)));
    const wordIds = (await tx.word.findMany({ where: { language, code: { in: [...targets] } }, select: { id: true } })).map((row) => row.id);
    const round = await importAnswer(run, sentences, await newBatch(run, "P_S", { level: level.level, word_ids: wordIds }), { sentences: chunk, issues: [] });
    const ok = accepted(round);
    for (const sentence of chunk) if (ok.has(sentence)) remember("sentence", sentence.text, sentence);
    count(run, "sentences", ok.size);
  }

  // Texts last: their sentences use the words above.
  codes = await wordCodes(tx, language);
  const waitingTexts = level.texts.filter((text) => fresh("text", text.code));
  const readyTexts = waitingTexts.filter((text) => text.codes.every((code) => codes.has(code)));
  if (readyTexts.length < waitingTexts.length) run.report.skipped.push(`${waitingTexts.length - readyTexts.length} texts use words not in the database`);
  if (readyTexts.length > 0) {
    const band = readyTexts[0].band;
    const length = (await appSetting<Record<string, [number, number]>>("prompt.text_bands"))[String(band)] ?? [30, 60];
    const specs = readyTexts.map((text) => ({ code: text.code, level: level.level, band: text.band, kind: text.kind, topic: "", placement_ok: text.placement_ok }));
    const round = await importAnswer(run, texts, await newBatch(run, "P_T", { level: level.level, band, length, words: null, texts: specs }), { texts: readyTexts.map((text) => text.answer), issues: [] });
    const ok = accepted(round);
    for (const text of readyTexts) if (ok.has(text.answer)) remember("text", text.code, text.answer);
    count(run, "texts", ok.size);
  }

  // Situational dialogues, one per batch (P-D): their lines and choices are sentences of the words above.
  const waitingDialogues = level.dialogues.filter((dialogue) => fresh("dialogue", dialogue.code));
  const readyDialogues = waitingDialogues.filter((dialogue) => dialogue.codes.every((code) => codes.has(code)));
  if (readyDialogues.length < waitingDialogues.length) run.report.skipped.push(`${waitingDialogues.length - readyDialogues.length} dialogues use words not in the database`);
  for (const dialogue of readyDialogues) {
    const round = await importAnswer(run, dialogues, await newBatch(run, "P_D", { level: level.level, code: dialogue.code, situation: dialogue.situation }), dialogue.answer);
    if (round.accepted.length > 0) remember("dialogue", dialogue.code, dialogue.answer);
    count(run, "dialogues", round.accepted.length);
  }

  // Phonics lessons: the teacher's list (`phonics.lessons.<language>`) names them and gives their place.
  const lessons = level.phonics.filter((lesson) => fresh("phonics", fold(lesson.label)));
  if (lessons.length > 0) {
    const planned = await appSetting<PlannedLesson[]>(`phonics.lessons.${language}`);
    const same = (a: string, b: string) => fold(a).replace(/\s+/g, " ").trim() === fold(b).replace(/\s+/g, " ").trim();
    for (const lesson of lessons) {
      const at = planned.findIndex((item) => same(item.label, lesson.label));
      if (at < 0) {
        run.report.skipped.push(`phonics «${lesson.label}»: not in the lesson list of the general settings`);
        continue;
      }
      const params = { level: "A1", label: planned[at].label, kind: planned[at].kind, order_no: at + 1 };
      const round = await importAnswer(run, phonics, await newBatch(run, "P_H", params), { lesson: lesson.record, issues: [] });
      if (round.accepted.length > 0) remember("phonics", fold(lesson.label), lesson.record);
      count(run, "phonics lessons", round.accepted.length);
    }
  }
}

/** Approves what this run imported, as if a teacher had checked it (PRD §13.4). */
async function approve(tx: Tx, batchIds: number[]) {
  const mine = { import_batch_id: { in: batchIds }, status: { in: ["draft" as const, "needs_review" as const] } };
  const approved = { status: "approved" as const };
  await tx.word.updateMany({ where: mine, data: approved });
  await tx.concept.updateMany({ where: mine, data: approved });
  await tx.sentence.updateMany({ where: mine, data: approved });
  await tx.sentenceTarget.updateMany({ where: mine, data: approved });
  await tx.grammarUnit.updateMany({ where: mine, data: approved });
  await tx.transformItem.updateMany({ where: mine, data: approved });
  await tx.translateItem.updateMany({ where: mine, data: approved });
  await tx.conjugationTable.updateMany({ where: mine, data: approved });
  await tx.text.updateMany({ where: mine, data: approved });
  await tx.dialogue.updateMany({ where: mine, data: approved });
  await tx.phonicsLesson.updateMany({ where: mine, data: approved });
}

/**
 * Ids of the packs' rows, per library list, so only they are published: a word loaded before its
 * sentences is published by the run that brings them. A pack row a teacher sent back to draft is not
 * approved, so it stays where the teacher put it.
 */
async function rowsOf(language: string): Promise<Partial<Record<LibrarySlug, Set<number>>>> {
  const batchIds = (await db.importBatch.findMany({ where: { language, prompt_version: PACK_VERSION }, select: { id: true } })).map((row) => row.id);
  const where = { where: { import_batch_id: { in: batchIds } }, select: { id: true } };
  const ids = (rows: { id: number }[]) => new Set(rows.map((row) => row.id));
  const out: Partial<Record<LibrarySlug, Set<number>>> = {
    words: ids(await db.word.findMany(where)),
    sentences: ids(await db.sentence.findMany(where)),
    units: ids(await db.grammarUnit.findMany(where)),
    tables: ids(await db.conjugationTable.findMany(where)),
    transforms: ids(await db.transformItem.findMany(where)),
    translations: ids(await db.translateItem.findMany(where)),
    texts: ids(await db.text.findMany(where)),
    dialogues: ids(await db.dialogue.findMany(where)),
    phonics: ids(await db.phonicsLesson.findMany(where)),
  };
  for (const slug of librarySlugs) if (out[slug]?.size === 0) delete out[slug];
  return out;
}

/** The levels of one language's pack, each in its own transaction; then publishing. */
export async function loadPack(pack: Pack, options: { adminId?: number | null; log?: (line: string) => void } = {}): Promise<LanguageReport> {
  const log = options.log ?? (() => {});
  const language = pack.language;
  const report: LanguageReport = { language, packErrors: pack.errors.length, levels: [], published: 0, blocked: 0, demoRemoved: false };
  if (pack.words.length === 0) return report;

  // The French demo's words share codes with the real ones; it goes before the real content comes in.
  if (language === "fr" && (await demoStatus()).loaded) {
    report.demoRemoved = (await removeDemo()).removed;
    log("Removed the French demo.");
  }

  const batches: number[] = [];
  for (const level of pack.levels) {
    const empty = [level.words, level.units, level.sentences, level.tables, level.texts, level.dialogues, level.phonics].every((list) => list.length === 0);
    if (empty) continue;
    const levelReport: LevelReport = { level: level.level, added: {}, rejected: [], skipped: [] };
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`;
        const rows = await tx.contentPackItem.findMany({ where: { language }, select: { kind: true, key: true } });
        const run: Run = { tx, language, adminId: options.adminId ?? null, batches: [], report: levelReport, ledger: new Set(rows.map((row) => ledgerKey(row.kind, row.key))), loaded: [] };
        await loadLevel(run, level);
        await approve(tx, run.batches);
        if (run.loaded.length > 0) await tx.contentPackItem.createMany({ data: run.loaded.map((item) => ({ language, ...item })), skipDuplicates: true });
        batches.push(...run.batches);
      },
      { timeout: 60 * 60_000, maxWait: 60_000 },
    );
    report.levels.push(levelReport);
    const added = Object.entries(levelReport.added).map(([kind, n]) => `${n} ${kind}`).join(", ");
    log(`${language} ${level.level}: ${added || "nothing new"}${levelReport.rejected.length ? `; ${levelReport.rejected.length} rejected` : ""}${levelReport.skipped.length ? `; ${levelReport.skipped.length} skipped` : ""}`);
    for (const line of [...levelReport.rejected, ...levelReport.skipped].slice(0, 20)) log(`  ${line}`);
  }

  if (batches.length > 0) {
    const result = await publishReady(language, options.adminId ?? null, await rowsOf(language));
    report.published = result.published;
    report.blocked = result.blocked;
    log(`${language}: published ${result.published}, ${result.blocked} not ready (see «انتشار»)`);
  }
  forgetContent();
  return report;
}

/** Every language with a pack. Levels follow `levels.<language>`; tables follow `conjugation.tenses.<language>`. */
export async function loadPacks(options: { languages?: LanguageCode[]; adminId?: number | null; log?: (line: string) => void } = {}): Promise<LanguageReport[]> {
  const out: LanguageReport[] = [];
  for (const language of options.languages ?? (["fr", "de"] as LanguageCode[])) {
    const [levels, tenses] = await Promise.all([appSetting<string[]>(`levels.${language}`), appSetting<Record<string, string[]>>(`conjugation.tenses.${language}`)]);
    const pack = buildPack(language, { levels, tenses });
    if (pack.errors.length > 0) options.log?.(`${language}: the pack has ${pack.errors.length} errors (npm run content:check); what is clean is loaded`);
    out.push(await loadPack(pack, options));
  }
  return out;
}
