import type { ImportBatch, Prisma, PromptKind } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { forgetContent } from "@/server/learn/content";
import {
  DEMO_MODEL,
  DEMO_VERSION,
  demoDialogues,
  demoTextCodes,
  demoUnits,
  dialogueAnswer,
  dialogueParams,
  errorfixAnswer,
  errorfixParams,
  grammarAnswer,
  sentencesAnswer,
  tablesAnswer,
  textsAnswer,
  textsParams,
  textsParamsFor,
  unitListAnswer,
  wordsAnswer,
  writingAnswer,
  writingParams,
} from "../../../fixtures/demo-fr/build";
import { demoPhonics } from "../../../fixtures/demo-fr/phonics";
import { formExceptions } from "../../../fixtures/demo-fr/words";
import { answerRecords } from "./batches";
import { conjugation } from "./kinds/conjugation";
import { dialogues } from "./kinds/dialogues";
import { errorfix } from "./kinds/errorfix";
import { grammar } from "./kinds/grammar";
import { phonics } from "./kinds/phonics";
import { sentences } from "./kinds/sentences";
import { texts } from "./kinds/texts";
import type { ContentKind, Tx } from "./kinds/types";
import { unitList } from "./kinds/unit-list";
import { words } from "./kinds/words";
import { writing } from "./kinds/writing";
import { mergeRound, type RoundResult } from "./report";

/**
 * The French demo for the tester account (DECISIONS.md, «محتوای نمونه فرانسوی»): about 60 A1 words
 * with their sentences, six grammar units, seven texts, three phonics lessons, two dialogues, two find-the-mistake texts and two
 * writing tasks, written by hand. It goes through the panel's own
 * importers, so it passes the same checks as chatbot answers, and is stored as approved: a tester
 * or an admin sees it, a learner never does (PRD §13.5). Every row carries prompt_version "demo-1",
 * which is how `removeDemo` finds it again.
 */

export const DEMO_LANGUAGE = "fr";

export type DemoStatus = { loaded: boolean; words: number; units: number; otherWords: number };

export async function demoStatus(): Promise<DemoStatus> {
  const [demo, units, other] = await Promise.all([
    db.word.count({ where: { language: DEMO_LANGUAGE, prompt_version: DEMO_VERSION, no_card: false } }),
    db.grammarUnit.count({ where: { language: DEMO_LANGUAGE, prompt_version: DEMO_VERSION } }),
    db.word.count({ where: { language: DEMO_LANGUAGE, NOT: { prompt_version: DEMO_VERSION } } }),
  ]);
  return { loaded: demo > 0, words: demo, units, otherWords: other };
}

export type LoadResult =
  | { kind: "loaded"; words: number; sentences: number; units: number; texts: number; phonics: number; speaking: number }
  /** The demo was there; texts and speaking and writing written after it was loaded were added (maybe 0). */
  | { kind: "already"; texts: number; speaking: number }
  | { kind: "has_content"; words: number };

async function newBatch(tx: Tx, kind: PromptKind, params: Record<string, unknown>, adminId: number | null) {
  return tx.importBatch.create({
    data: {
      language: DEMO_LANGUAGE,
      prompt_kind: kind,
      prompt_version: DEMO_VERSION,
      model_name: DEMO_MODEL,
      prompt_text: "محتوای نمونه آزمایشی (بدون پرامپت)",
      params: params as Prisma.InputJsonValue,
      created_by: adminId,
    },
  });
}

/** Imports one answer through its kind's importer; any record it does not take cleanly stops the load. */
async function importAnswer(tx: Tx, kind: ContentKind, batch: ImportBatch, answer: Record<string, unknown>) {
  const content = answerRecords(kind, answer);
  if (!content) throw new Error(`Demo answer for ${kind.kind} has none of its keys`);
  const round: RoundResult = await kind.importRecords(tx, batch, content.records, content.parts, batch.created_by);
  const trouble = [
    ...round.rejected.map((item) => `${item.label}: ${JSON.stringify(item.problems)}`),
    ...(round.candidates > 0 ? [`${round.candidates} candidates`] : []),
    ...(round.suspects > 0 ? [`${round.suspects} suspects`] : []),
  ];
  if (trouble.length > 0) throw new Error(`Demo ${kind.kind} did not import cleanly:\n${trouble.join("\n")}`);
  await tx.importBatch.update({
    where: { id: batch.id },
    data: { state: "reviewed", raw_output: JSON.stringify(answer), report: { ...mergeRound(null, round, []), accepted: [], rejected: [] } as unknown as Prisma.InputJsonValue },
  });
  return round;
}

/**
 * Loads the demo. A language that already has other words is left alone: the demo would mix with
 * the teacher's own order and codes.
 */
export async function loadDemo(adminId: number | null = null): Promise<LoadResult> {
  const status = await demoStatus();
  if (status.loaded) return { kind: "already", texts: await addNewTexts(adminId), speaking: await addSpeaking(adminId) };
  if (status.otherWords > 0) return { kind: "has_content", words: status.otherWords };

  const counts = await db.$transaction(
    async (tx) => {
      await importAnswer(tx, unitList, await newBatch(tx, "P_U", { level: "A1", summary: [] }, adminId), unitListAnswer());
      await importAnswer(tx, words, await newBatch(tx, "P_W", { level: "A1", word_ids: [], summary: [] }, adminId), wordsAnswer());
      for (const item of formExceptions) {
        const word = await tx.word.findFirstOrThrow({ where: { language: DEMO_LANGUAGE, code: item.code }, select: { id: true } });
        await tx.formException.create({ data: { word_id: word.id, surface: item.surface } });
      }
      await importAnswer(tx, conjugation, await newBatch(tx, "P_X", { level: "A1", summary: [] }, adminId), tablesAnswer());
      const bank = sentencesAnswer();
      await importAnswer(tx, sentences, await newBatch(tx, "P_S", { level: "A1", word_ids: [], summary: [] }, adminId), bank);
      for (const unit of demoUnits) {
        const row = await tx.grammarUnit.findUniqueOrThrow({ where: { unit_code: unit.code }, select: { id: true } });
        await importAnswer(tx, grammar, await newBatch(tx, "P_G", { level: "A1", unit_id: row.id, unit_code: unit.code, summary: [] }, adminId), grammarAnswer(unit));
      }
      await importAnswer(tx, texts, await newBatch(tx, "P_T", { ...textsParams, summary: [] }, adminId), textsAnswer());
      for (const { orderNo, lesson } of demoPhonics) {
        const params = { level: "A1", label: lesson.sound_label, kind: lesson.kind, order_no: orderNo, summary: [] };
        await importAnswer(tx, phonics, await newBatch(tx, "P_H", params, adminId), { lesson });
      }
      await importSpeaking(tx, adminId);

      // Approved, as if the teacher had checked every row (PRD §13.4); never published.
      const batchIds = (await tx.importBatch.findMany({ where: { language: DEMO_LANGUAGE, prompt_version: DEMO_VERSION }, select: { id: true } })).map((row) => row.id);
      const mine = { import_batch_id: { in: batchIds } };
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
      await tx.question.updateMany({ where: mine, data: approved });
      await tx.phonicsLesson.updateMany({ where: mine, data: approved });
      await approveSpeaking(tx, mine);
      return {
        words: await tx.word.count({ where: { ...mine, no_card: false } }),
        sentences: await tx.sentence.count({ where: mine }),
        units: await tx.grammarUnit.count({ where: mine }),
        texts: await tx.text.count({ where: mine }),
        phonics: await tx.phonicsLesson.count({ where: mine }),
        speaking: await speakingCount(tx, mine),
      };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
  forgetContent();
  return { kind: "loaded", ...counts };
}

type Mine = { import_batch_id: { in: number[] } | number };

/** Speaking and writing (PRD §8b): one P-D batch per dialogue, then P-E and P-WR. */
async function importSpeaking(tx: Tx, adminId: number | null) {
  for (const dialogue of demoDialogues) {
    await importAnswer(tx, dialogues, await newBatch(tx, "P_D", { ...dialogueParams(dialogue), summary: [] }, adminId), dialogueAnswer(dialogue));
  }
  await importAnswer(tx, errorfix, await newBatch(tx, "P_E", { ...errorfixParams, summary: [] }, adminId), errorfixAnswer());
  await importAnswer(tx, writing, await newBatch(tx, "P_WR", { ...writingParams, summary: [] }, adminId), writingAnswer());
}

async function approveSpeaking(tx: Tx, mine: Mine) {
  const approved = { status: "approved" as const };
  await tx.sentence.updateMany({ where: mine, data: approved });
  await tx.dialogue.updateMany({ where: mine, data: approved });
  await tx.errorfixItem.updateMany({ where: mine, data: approved });
  await tx.writingTask.updateMany({ where: mine, data: approved });
}

const speakingCount = async (tx: Tx, mine: Mine) => (await tx.dialogue.count({ where: mine })) + (await tx.errorfixItem.count({ where: mine })) + (await tx.writingTask.count({ where: mine }));

/**
 * Speaking and writing came after the first demo: a server that loaded it before gets them on the next
 * load, approved like the rest. Returns how many dialogues, texts and tasks were added.
 */
async function addSpeaking(adminId: number | null): Promise<number> {
  const there = await db.importBatch.count({ where: { language: DEMO_LANGUAGE, prompt_version: DEMO_VERSION, prompt_kind: { in: ["P_D", "P_E", "P_WR"] } } });
  if (there > 0) return 0;
  const added = await db.$transaction(
    async (tx) => {
      const before = (await tx.importBatch.aggregate({ _max: { id: true } }))._max.id ?? 0;
      await importSpeaking(tx, adminId);
      const ids = (await tx.importBatch.findMany({ where: { id: { gt: before }, language: DEMO_LANGUAGE, prompt_version: DEMO_VERSION }, select: { id: true } })).map((row) => row.id);
      const mine = { import_batch_id: { in: ids } };
      await approveSpeaking(tx, mine);
      return speakingCount(tx, mine);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  forgetContent();
  return added;
}

/**
 * Texts added to the demo after a server loaded it come in on the next load (at start with
 * `DEMO_CONTENT=fr`), through the same importer and approved like the rest. Returns how many.
 */
async function addNewTexts(adminId: number | null): Promise<number> {
  const there = new Set((await db.text.findMany({ where: { language: DEMO_LANGUAGE, code: { in: demoTextCodes } }, select: { code: true } })).map((text) => text.code));
  const missing = new Set(demoTextCodes.filter((code) => !there.has(code)));
  if (missing.size === 0) return 0;
  const added = await db.$transaction(
    async (tx) => {
      const batch = await newBatch(tx, "P_T", { ...textsParamsFor(missing), summary: [] }, adminId);
      await importAnswer(tx, texts, batch, textsAnswer(missing));
      const mine = { import_batch_id: batch.id };
      const approved = { status: "approved" as const };
      await tx.sentence.updateMany({ where: mine, data: approved });
      await tx.text.updateMany({ where: mine, data: approved });
      await tx.question.updateMany({ where: mine, data: approved });
      return tx.text.count({ where: mine });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  forgetContent();
  return added;
}

/**
 * Removes the demo and everything learners did with it: their item states, text, phonics and speaking states, writings,
 * logs, notebook rows, queue and confusion pairs for these items, and any open session of the language.
 */
export async function removeDemo(): Promise<{ removed: boolean }> {
  const batchIds = (await db.importBatch.findMany({ where: { language: DEMO_LANGUAGE, prompt_version: DEMO_VERSION }, select: { id: true } })).map((row) => row.id);
  if (batchIds.length === 0) return { removed: false };
  const mine = { import_batch_id: { in: batchIds } };

  await db.$transaction(
    async (tx) => {
      const ids = async (rows: Promise<{ id: number }[]>) => (await rows).map((row) => row.id);
      const wordIds = await ids(tx.word.findMany({ where: mine, select: { id: true } }));
      const unitIds = await ids(tx.grammarUnit.findMany({ where: mine, select: { id: true } }));
      const conjIds = await ids(tx.conjugationTable.findMany({ where: mine, select: { id: true } }));
      const targetIds = await ids(tx.sentenceTarget.findMany({ where: mine, select: { id: true } }));
      const textIds = await ids(tx.text.findMany({ where: mine, select: { id: true } }));
      const lessonIds = await ids(tx.phonicsLesson.findMany({ where: mine, select: { id: true } }));
      const sentenceIds = await ids(tx.sentence.findMany({ where: mine, select: { id: true } }));
      const dialogueIds = await ids(tx.dialogue.findMany({ where: mine, select: { id: true } }));
      const errorfixIds = await ids(tx.errorfixItem.findMany({ where: mine, select: { id: true } }));
      const taskIds = await ids(tx.writingTask.findMany({ where: mine, select: { id: true } }));
      const items = [
        { item_type: "word" as const, item_id: { in: wordIds } },
        { item_type: "grammar_unit" as const, item_id: { in: unitIds } },
        { item_type: "conjugation" as const, item_id: { in: conjIds } },
      ];
      const textItems = { item_type: "text" as const, item_id: { in: textIds } };
      const lessonItems = { item_type: "phonics_lesson" as const, item_id: { in: lessonIds } };
      const language = DEMO_LANGUAGE;
      await tx.itemState.deleteMany({ where: { language, OR: items } });
      const speakingItems = [
        { item_type: "sentence", item_id: { in: sentenceIds } },
        { item_type: "dialogue", item_id: { in: dialogueIds } },
        { item_type: "errorfix_item", item_id: { in: errorfixIds } },
      ];
      await tx.reviewLog.deleteMany({ where: { language, OR: [...items, textItems, lessonItems, ...speakingItems] } });
      await tx.speakState.deleteMany({ where: { sentence_id: { in: sentenceIds } } });
      await tx.dialogueState.deleteMany({ where: { dialogue_id: { in: dialogueIds } } });
      await tx.errorfixState.deleteMany({ where: { errorfix_item_id: { in: errorfixIds } } });
      await tx.writingEntry.deleteMany({ where: { writing_task_id: { in: taskIds } } });
      await tx.textState.deleteMany({ where: { text_id: { in: textIds } } });
      await tx.phonicsState.deleteMany({ where: { lesson_id: { in: lessonIds } } });
      await tx.notebookEntry.deleteMany({
        where: {
          language,
          OR: [
            { ref_type: { in: ["word", "word_gender"] }, ref_id: { in: wordIds } },
            { ref_type: "conjugation", ref_id: { in: conjIds } },
            { ref_type: "grammar_target", ref_id: { in: targetIds } },
          ],
        },
      });
      await tx.newWordQueue.deleteMany({ where: { language, word_id: { in: wordIds } } });
      await tx.confusionPair.deleteMany({ where: { language, OR: [{ word_id: { in: wordIds } }, { other_word_id: { in: wordIds } }] } });
      await tx.session.deleteMany({ where: { language, ended_at: null } });

      await tx.question.deleteMany({ where: { text_id: { in: textIds } } });
      await tx.text.deleteMany({ where: mine });
      await tx.phonicsLesson.deleteMany({ where: mine });
      await tx.dialogue.deleteMany({ where: mine });
      await tx.errorfixItem.deleteMany({ where: mine });
      await tx.writingTask.deleteMany({ where: mine });
      await tx.sentence.deleteMany({ where: mine });
      await tx.translateItem.deleteMany({ where: mine });
      await tx.transformItem.deleteMany({ where: mine });
      await tx.conjugationTable.deleteMany({ where: mine });
      await tx.grammarUnit.deleteMany({ where: mine });
      await tx.word.deleteMany({ where: mine });
      await tx.concept.deleteMany({ where: mine });
      await tx.importBatch.deleteMany({ where: { id: { in: batchIds } } });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  forgetContent();
  return { removed: true };
}
