import type { ImportBatch, Prisma, PromptKind } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { forgetContent } from "@/server/learn/content";
import { DEMO_MODEL, DEMO_VERSION, demoUnits, grammarAnswer, sentencesAnswer, tablesAnswer, unitListAnswer, wordsAnswer } from "../../../fixtures/demo-fr/build";
import { formExceptions } from "../../../fixtures/demo-fr/words";
import { answerRecords } from "./batches";
import { conjugation } from "./kinds/conjugation";
import { grammar } from "./kinds/grammar";
import { sentences } from "./kinds/sentences";
import type { ContentKind, Tx } from "./kinds/types";
import { unitList } from "./kinds/unit-list";
import { words } from "./kinds/words";
import type { RoundResult } from "./report";

/**
 * The French demo for the tester account (DECISIONS.md, «محتوای نمونه فرانسوی»): about 60 A1 words
 * with their sentences and six grammar units, written by hand. It goes through the panel's own
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

export type LoadResult = { kind: "loaded"; words: number; sentences: number; units: number } | { kind: "already" } | { kind: "has_content"; words: number };

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
  const round: RoundResult = await kind.importRecords(tx, batch, content.records, content.parts);
  const trouble = [
    ...round.rejected.map((item) => `${item.label}: ${JSON.stringify(item.problems)}`),
    ...(round.candidates > 0 ? [`${round.candidates} candidates`] : []),
    ...(round.suspects > 0 ? [`${round.suspects} suspects`] : []),
  ];
  if (trouble.length > 0) throw new Error(`Demo ${kind.kind} did not import cleanly:\n${trouble.join("\n")}`);
  await tx.importBatch.update({
    where: { id: batch.id },
    data: { state: "reviewed", raw_output: JSON.stringify(answer), report: { ...round, accepted: [], rejected: [] } as unknown as Prisma.InputJsonValue },
  });
  return round;
}

/**
 * Loads the demo. A language that already has other words is left alone: the demo would mix with
 * the teacher's own order and codes.
 */
export async function loadDemo(adminId: number | null = null): Promise<LoadResult> {
  const status = await demoStatus();
  if (status.loaded) return { kind: "already" };
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
      return {
        words: await tx.word.count({ where: { ...mine, no_card: false } }),
        sentences: await tx.sentence.count({ where: mine }),
        units: await tx.grammarUnit.count({ where: mine }),
      };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
  forgetContent();
  return { kind: "loaded", ...counts };
}

/**
 * Removes the demo and everything learners did with it: their item states, logs, notebook rows,
 * queue and confusion pairs for these items, and any open session of the language.
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
      const items = [
        { item_type: "word" as const, item_id: { in: wordIds } },
        { item_type: "grammar_unit" as const, item_id: { in: unitIds } },
        { item_type: "conjugation" as const, item_id: { in: conjIds } },
      ];
      const language = DEMO_LANGUAGE;
      await tx.itemState.deleteMany({ where: { language, OR: items } });
      await tx.reviewLog.deleteMany({ where: { language, OR: items } });
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
