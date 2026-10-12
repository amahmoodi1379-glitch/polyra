import type { Pos } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { wordListItem } from "@/schemas/words";
import { db } from "@/server/db";
import { lastIntroOrder } from "../intro-order";
import { problem, zodProblems } from "../problems";
import { emptyRound } from "../report";
import { batchSize, example, labelOf, languageValues, params, trace } from "./shared";
import type { ContentKind } from "./types";

type WordListParams = { first_rank: number; last_rank: number; count: number };

/** A code that is free in this language: the lemma, else lemma-pos, else lemma-pos-2 ... */
function freeCode(lemma: string, pos: string, taken: Set<string>) {
  const candidates = [lemma, `${lemma}-${pos}`];
  for (let n = 2; n < 50; n++) candidates.push(`${lemma}-${pos}-${n}`);
  const code = candidates.find((candidate) => !taken.has(candidate))!;
  taken.add(code);
  return code;
}

/**
 * P-C (PRD §14.5): the next 200 unused rows of the frequency list. Every kept lemma becomes a draft
 * word with only lemma, pos, level and no_card (PRD §13.9), appended to its level's order, so the
 * workbench knows which words still need P-W.
 */
export const wordList: ContentKind = {
  kind: "P_C",
  template: "P-C.md",
  rootKey: "items",

  async plan(language) {
    const size = await batchSize("P-C", 200);
    const items = await db.frequencyItem.findMany({
      where: { language, used_in_batch_id: null },
      orderBy: { rank: "asc" },
      take: size,
    });
    if (items.length === 0) return { nothing: t("admin.create.nothing.frequency") };
    const first = items[0].rank;
    const last = items[items.length - 1].rank;
    return {
      params: { first_rank: first, last_rank: last, count: items.length } satisfies WordListParams,
      values: {
        ...languageValues(language),
        level: "A1 تا B2",
        items: items.map((item) => item.lemma).join("\n"),
        example: example("P-C", language),
      },
      summary: [t("admin.create.summary.wordList", { count: items.length, first, last })],
      level: "A1 تا B2",
    };
  },

  async reserve(tx, batch) {
    const { first_rank, last_rank } = params<WordListParams>(batch);
    await tx.frequencyItem.updateMany({
      where: { language: batch.language, rank: { gte: first_rank, lte: last_rank }, used_in_batch_id: null },
      data: { used_in_batch_id: batch.id },
    });
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const language = batch.language;
    const ranks = new Map(
      (await tx.frequencyItem.findMany({ where: { language, used_in_batch_id: batch.id } })).map((item) => [
        fold(item.lemma),
        item.rank,
      ]),
    );
    const existing = await tx.word.findMany({ where: { language }, select: { code: true, lemma: true, pos: true } });
    const taken = new Set(existing.map((word) => word.code));
    const known = new Set(existing.map((word) => `${fold(word.lemma)}|${word.pos}`));
    const nextOrder = new Map<string, number>();

    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["lemma"], index);
      // A row the chatbot left out needs no part of speech or level, so nothing else is checked.
      if (typeof record === "object" && record !== null && (record as { keep?: unknown }).keep === false) {
        round.dropped++;
        continue;
      }
      const parsed = wordListItem.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        round.rejected.push({ label, record, problems: zodProblems(parsed.error) });
        continue;
      }
      const item = parsed.data;
      const missing = [!item.pos && "pos", !item.level && "level"].filter((field): field is string => Boolean(field));
      if (missing.length > 0) {
        round.rejected.push({ label, record, problems: missing.map((field) => problem("missing", { field })) });
        continue;
      }
      const pos = item.pos as Pos;
      const level = item.level!;
      const key = `${fold(item.lemma)}|${pos}`;
      if (known.has(key)) {
        round.skipped++;
        continue;
      }
      known.add(key);

      const rank = ranks.get(fold(item.lemma)) ?? null;
      if (rank === null) round.warnings.push({ label, problem: problem("notInInput", { lemma: item.lemma }) });
      if (!nextOrder.has(level)) nextOrder.set(level, await lastIntroOrder(tx, language, level));
      const order = nextOrder.get(level)! + 1;
      nextOrder.set(level, order);

      const word = await tx.word.create({
        data: {
          language,
          code: freeCode(item.lemma, pos, taken),
          lemma: item.lemma,
          pos,
          level,
          no_card: item.no_card,
          intro_order: order,
          frequency_rank: rank,
          ...trace(batch),
        },
      });
      round.added++;
      round.accepted.push({ label: item.lemma, entity: { type: "word", id: word.id }, record });
    }
    return round;
  },
};
