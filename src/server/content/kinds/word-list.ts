import type { Pos } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { cleanText } from "@/lib/clean-text";
import { t } from "@/i18n";
import { wordListItem } from "@/schemas/words";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { freeCode } from "../codes";
import { lastIntroOrder } from "../intro-order";
import { problem, zodProblems } from "../problems";
import { emptyRound } from "../report";
import { batchSize, example, labelOf, languageValues, levelProblem, namesAsked, params, texts, trace } from "./shared";
import type { ContentKind } from "./types";

/** `custom`: the teacher's own words instead of the frequency list; `fixed_level`: the level they chose for all. */
type WordListParams = { first_rank: number; last_rank: number; count: number; custom?: string[]; fixed_level?: string | null };

/** Most words one list of the teacher's own may hold. */
export const MAX_CUSTOM_WORDS = 1000;

/** The teacher's lines: one word or phrase each, cleaned, without repeats, in their order. */
export function customWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of cleanText(text).split(/\r?\n|[،,;؛]/)) {
    const word = line.replace(/\s+/g, " ").trim();
    if (!word || word.length > 80 || seen.has(fold(word))) continue;
    seen.add(fold(word));
    out.push(word);
  }
  return out.slice(0, MAX_CUSTOM_WORDS);
}

/**
 * P-C (PRD §14.5): the next 200 unused rows of the frequency list, or the teacher's own words (owner's
 * choice, DECISIONS.md). Every kept lemma becomes a draft word with only lemma, pos, level and no_card
 * (PRD §13.9), appended to its level's order, so the workbench knows which words still need P-W.
 */
export const wordList: ContentKind = {
  kind: "P_C",
  template: "P-C.md",
  rootKey: "items",
  /** Some row is a lemma of this batch's part of the frequency list, or of the teacher's own words. */
  async matches(batch, _answer, records) {
    const custom = params<WordListParams>(batch).custom;
    const asked = custom ?? (await db.frequencyItem.findMany({ where: { language: batch.language, used_in_batch_id: batch.id }, select: { lemma: true } })).map((item) => item.lemma);
    return namesAsked(records, new Set(asked.map((lemma) => fold(lemma))), (record) => texts(record, ["lemma"]).map((lemma) => fold(lemma.trim())));
  },

  async plan(language, options) {
    if (options.words) {
      const words = options.words.slice(0, MAX_CUSTOM_WORDS);
      if (words.length === 0) return { nothing: t("admin.create.custom.empty") };
      const levels = await appSetting<string[]>(`levels.${language}`);
      const fixed = options.level && levels.includes(options.level) ? options.level : null;
      return {
        params: { first_rank: 0, last_rank: 0, count: words.length, custom: words, fixed_level: fixed } satisfies WordListParams,
        values: {
          ...languageValues(language),
          level: fixed ?? "A1 تا B2",
          items: words.join("\n"),
          note: fixed ? t("admin.create.custom.noteLevel", { level: fixed }) : t("admin.create.custom.note"),
          example: example("P-C", language),
        },
        summary: [t("admin.create.summary.customWords", { count: words.length })],
        level: fixed ?? "A1 تا B2",
      };
    }
    const size = await batchSize("P-C", 200, options.size);
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
        note: "",
        example: example("P-C", language),
      },
      summary: [t("admin.create.summary.wordList", { count: items.length, first, last })],
      level: "A1 تا B2",
    };
  },

  async reserve(tx, batch) {
    const { first_rank, last_rank, custom } = params<WordListParams>(batch);
    if (custom) {
      // The teacher's words that are also on the frequency list are not offered again from there.
      await tx.frequencyItem.updateMany({ where: { language: batch.language, used_in_batch_id: null, lemma: { in: custom } }, data: { used_in_batch_id: batch.id } });
      return;
    }
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
    const { custom, fixed_level: fixedLevel } = params<WordListParams>(batch);
    const asked = custom ? new Set(custom.map((lemma) => fold(lemma))) : null;
    const existing = await tx.word.findMany({ where: { language }, select: { code: true, lemma: true, pos: true } });
    const levels = await appSetting<string[]>(`levels.${language}`);
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
      const item = fixedLevel ? { ...parsed.data, level: fixedLevel } : parsed.data;
      const missing = [!item.pos && "pos", !item.level && "level"].filter((field): field is string => Boolean(field));
      const problems = [...missing.map((field) => problem("missing", { field })), ...(item.level ? levelProblem(levels, item.level) : [])];
      if (problems.length > 0) {
        round.rejected.push({ label, record, problems });
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
      if (asked ? !asked.has(fold(item.lemma)) : rank === null) round.warnings.push({ label, problem: problem("notInInput", { lemma: item.lemma }) });
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
