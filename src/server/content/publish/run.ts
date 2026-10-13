import type { ContentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Tx } from "../kinds/types";
import { turnSentenceIds } from "../library/list";
import { logChange } from "../library/log";
import { librarySlugs, type LibrarySlug } from "../library/slugs";
import { checkItems, type CheckedItem } from "./checks";

/**
 * «همه تأییدشده‌های آماده را منتشر کن» (PRD §13.5): every `approved` item whose conditions hold
 * becomes `published` in one go; the others stay `approved` with their reasons. Rows that live
 * inside an item follow it: the sentences of a text or a dialogue, a text's questions, and a
 * sentence target once both its sentence and its word or unit are published.
 */

export type PublishPreview = { ready: CheckedItem[]; blocked: CheckedItem[] };
export type PublishResult = { published: number; bySlug: Partial<Record<LibrarySlug, number>>; blocked: number };

const publishedOnly = { status: "published" as ContentStatus };
const notYet = { notIn: ["published", "retired"] as ContentStatus[] };

export async function previewPublish(language: string): Promise<PublishPreview> {
  const checked = await checkItems(db, { language, statuses: ["approved"] });
  return { ready: checked.filter((item) => item.reasons.length === 0), blocked: checked.filter((item) => item.reasons.length > 0) };
}

async function setPublished(tx: Tx, slug: LibrarySlug, ids: number[]) {
  const args = { where: { id: { in: ids }, status: "approved" as ContentStatus }, data: publishedOnly };
  switch (slug) {
    case "words":
      return (await tx.word.updateMany(args)).count;
    case "sentences":
      return (await tx.sentence.updateMany(args)).count;
    case "units":
      return (await tx.grammarUnit.updateMany(args)).count;
    case "tables":
      return (await tx.conjugationTable.updateMany(args)).count;
    case "transforms":
      return (await tx.transformItem.updateMany(args)).count;
    case "translations":
      return (await tx.translateItem.updateMany(args)).count;
    case "texts":
      return (await tx.text.updateMany(args)).count;
    case "dialogues":
      return (await tx.dialogue.updateMany(args)).count;
    case "errorfix":
      return (await tx.errorfixItem.updateMany(args)).count;
    case "writing":
      return (await tx.writingTask.updateMany(args)).count;
    case "phonics":
      return (await tx.phonicsLesson.updateMany(args)).count;
  }
}

/** Child rows of published items that are not published yet. */
async function publishChildren(tx: Tx, language: string, texts: number[], dialogues: number[]) {
  // The sentences of a text or a dialogue were checked with it and are reviewed as part of it.
  const owned = [
    ...(await tx.text.findMany({ where: { id: { in: texts } }, select: { sentence_ids: true } })).flatMap((row) => row.sentence_ids),
    ...(await tx.dialogue.findMany({ where: { id: { in: dialogues } }, select: { turns: true } })).flatMap((row) => turnSentenceIds(row.turns)),
  ];
  const sentences = owned.length ? (await tx.sentence.updateMany({ where: { id: { in: owned }, status: notYet }, data: publishedOnly })).count : 0;
  const questions = (await tx.question.updateMany({ where: { language, status: notYet, text: { status: "published" } }, data: publishedOnly })).count;

  const waiting = await tx.sentenceTarget.findMany({
    where: { language, status: notYet, sentence: { status: "published" } },
    select: { id: true, target_type: true, target_id: true },
  });
  const ofType = (type: "word" | "grammar") => [...new Set(waiting.filter((row) => row.target_type === type).map((row) => row.target_id))];
  const [words, units] = await Promise.all([
    tx.word.findMany({ where: { id: { in: ofType("word") }, status: "published" }, select: { id: true } }),
    tx.grammarUnit.findMany({ where: { id: { in: ofType("grammar") }, status: "published" }, select: { id: true } }),
  ]);
  const live = { word: new Set(words.map((row) => row.id)), grammar: new Set(units.map((row) => row.id)) };
  const targetIds = waiting.filter((row) => live[row.target_type].has(row.target_id)).map((row) => row.id);
  const targets = targetIds.length ? (await tx.sentenceTarget.updateMany({ where: { id: { in: targetIds } }, data: publishedOnly })).count : 0;
  return { sentences, questions, targets };
}

export async function publishReady(language: string, adminId: number): Promise<PublishResult> {
  return db.$transaction(
    async (tx) => {
      const checked = await checkItems(tx, { language, statuses: ["approved"] });
      const ready = checked.filter((item) => item.reasons.length === 0);
      const ids: Partial<Record<LibrarySlug, number[]>> = {};
      for (const item of ready) (ids[item.slug] ??= []).push(item.id);

      const bySlug: Partial<Record<LibrarySlug, number>> = {};
      let published = 0;
      for (const slug of librarySlugs) {
        if (!ids[slug]?.length) continue;
        bySlug[slug] = await setPublished(tx, slug, ids[slug]);
        published += bySlug[slug];
      }
      const children = await publishChildren(tx, language, ids.texts ?? [], ids.dialogues ?? []);
      if (published > 0 || children.targets > 0 || children.questions > 0 || children.sentences > 0) {
        await logChange(tx, adminId, { action: "publish", entity: "publish", entityId: language, before: null, after: { items: ids, children } });
      }
      return { published, bySlug, blocked: checked.length - ready.length };
    },
    { timeout: 120_000 },
  );
}
