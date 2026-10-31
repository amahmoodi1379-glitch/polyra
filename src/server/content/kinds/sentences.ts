import { CARD_REGISTERS, isCardRegister } from "@/engine/content";
import type { Prisma } from "@/generated/prisma/client";
import { t } from "@/i18n";
import { sentenceRecord, type SentenceTargetRecord } from "@/schemas/sentences";
import { db } from "@/server/db";
import { appSetting, engineNumber } from "@/server/settings/read";
import { levelRank } from "../languages";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { loadVocabulary, type LoadedVocabulary } from "../vocabulary";
import { addTargets, blankHoldsWord, checkTarget, lengthFlags, mapSentence, storeSentence, targetOptions } from "./sentence-store";
import { batchSize, example, labelOf, languageValues, lines, namesAsked, params, texts } from "./shared";
import { openParams } from "./targets";
import type { ContentKind, Tx } from "./types";

type SentencesParams = { level: string; word_ids: number[] };

/** Card words: words of a card register with a meaning that are not no_card (colloquial ones have no sentences, PRD §5.4). */
export const cardWord = { meaning_fa: { not: null }, no_card: false, register: { in: [...CARD_REGISTERS] }, dup_of_id: null, status: { not: "retired" } } satisfies Prisma.WordWhereInput;
/** The first words of a language get sentences made only from themselves (PRD §14.9). */
const FIRST_WORDS = 30;

type OrderedCard = { id: number; level: string; intro_order: number | null; no_card: boolean; register: string };

/** The first card words a learner meets, from words that are not retired and not duplicates (PRD §14.9). */
export function firstWordIds(words: OrderedCard[]): Set<number> {
  const ordered = words
    .filter((word) => !word.no_card && isCardRegister(word.register))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9));
  return new Set(ordered.slice(0, FIRST_WORDS).map((word) => word.id));
}
/** Above this many allowed words the meanings are left out so the prompt fits (PRD §14.9). */
const LIST_WITH_MEANINGS = 600;

async function resolveTarget(tx: Tx, language: string, target: SentenceTargetRecord, vocabulary: LoadedVocabulary) {
  if (target.type === "word") return vocabulary.byCode(target.target)?.id ?? null;
  const unit = await tx.grammarUnit.findFirst({ where: { language, unit_code: target.target }, select: { id: true } });
  return unit?.id ?? null;
}

/**
 * P-S (PRD §14.5): sentences for the next 10 card words that have fewer than 8 targets, or for the
 * words «سلامت محتوا» sends (`wordIds`, PRD §13.11), however many sentences they have. Each
 * sentence's word mapping is checked (PRD §14.1) and stored as sentence_word rows; unknown codes
 * become candidates and implausible mappings suspects, for the admin to resolve (PRD §13.9).
 */
export const sentences: ContentKind = {
  kind: "P_S",
  template: "P-S.md",
  rootKey: "sentences",
  /** Some sentence maps or targets a word this batch asked for. */
  async matches(batch, _answer, records) {
    const asked = await db.word.findMany({ where: { id: { in: params<SentencesParams>(batch).word_ids } }, select: { code: true } });
    const codes = new Set(asked.map((word) => word.code));
    const listed = (record: unknown, key: string) => {
      const list = record && typeof record === "object" ? (record as Record<string, unknown>)[key] : null;
      return Array.isArray(list) ? list : [];
    };
    return namesAsked(records, codes, (record) =>
      [...listed(record, "targets").flatMap((target) => texts(target, ["target"])), ...listed(record, "tokens").flatMap((token) => texts(token, ["code"]))].map((code) => code.trim()),
    );
  },

  async plan(language, options) {
    const goal = await engineNumber("publish.word_goal_targets");
    const levels = await appSetting<string[]>(`levels.${language}`);
    const lengths = await appSetting<Record<string, string>>("prompt.sentence_length");
    const size = await batchSize("P-S", 10);

    const chosen = options.wordIds?.length ? options.wordIds : null;
    const candidates = await db.word.findMany({
      where: { language, ...cardWord, ...(chosen ? { id: { in: chosen } } : options.level ? { level: options.level } : {}) },
      orderBy: [{ intro_order: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      select: { id: true, code: true, pos: true, meaning_fa: true, level: true, intro_order: true },
    });
    const counts = new Map(
      (
        await db.sentenceTarget.groupBy({
          by: ["target_id"],
          where: { language, target_type: "word", status: { not: "retired" } },
          _count: true,
        })
      ).map((row) => [row.target_id, row._count]),
    );
    // Words an open batch already asks for wait for its answer, unless the admin chose them.
    const held = new Set((await openParams<SentencesParams>(language, "P_S")).flatMap((open) => open.word_ids ?? []));
    const needy = candidates
      .filter((word) => chosen || ((counts.get(word.id) ?? 0) < goal && !held.has(word.id)))
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9));
    const level = needy.find((word) => levels.includes(word.level))?.level;
    if (!level) return { nothing: t("admin.create.nothing.sentences") };
    // The quality check reads at most «P-QA» sentences at once (PRD §14.9), so one batch asks for no more.
    const fit = Math.max(1, Math.floor((await batchSize("P-QA", 100)) / goal));
    const batch = needy.filter((word) => word.level === level).slice(0, Math.min(size, fit));
    // Words chosen on «سلامت محتوا» have sentences that use later words: their new sentences may use
    // only words met before the first of them, so each sentence is usable for every target.
    const cutOrder = chosen ? Math.min(...batch.map((word) => word.intro_order ?? 1e9)) : Math.max(...batch.map((word) => word.intro_order ?? 0));

    // The allowed list: no_card words, plus every word introduced before these targets (PRD §14.9).
    const all = await db.word.findMany({
      where: { language, status: { not: "retired" }, dup_of_id: null },
      orderBy: [{ intro_order: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      select: { id: true, code: true, pos: true, meaning_fa: true, level: true, intro_order: true, no_card: true, register: true },
    });
    const firstWords = firstWordIds(all);
    const targetIds = new Set(batch.map((word) => word.id));
    const early = batch.every((word) => firstWords.has(word.id));
    const allowed = all.filter((word) => {
      if (targetIds.has(word.id)) return false;
      if (word.no_card) return true;
      if (!isCardRegister(word.register)) return false;
      if (early) return firstWords.has(word.id);
      const rank = levelRank(word.level) - levelRank(level);
      return rank < 0 || (rank === 0 && (word.intro_order ?? 1e9) < cutOrder);
    });
    const withMeaning = allowed.length <= LIST_WITH_MEANINGS;
    const line = (word: { code: string; pos: string; meaning_fa: string | null }, meaning = true) =>
      [word.code, word.pos, ...(meaning ? [word.meaning_fa ?? "—"] : [])].join(" | ");

    return {
      params: { level, word_ids: batch.map((word) => word.id) } satisfies SentencesParams,
      values: {
        ...languageValues(language),
        level,
        count: String(goal),
        targets: batch.map((word) => line(word)).join("\n"),
        allowed: lines([...batch.map((word) => line(word, withMeaning)), ...allowed.map((word) => line(word, withMeaning))]),
        length: lengths[level] ?? "4 تا 10",
        example: example("P-S", language),
      },
      summary: [t("admin.create.summary.sentences", { count: batch.length, level, goal }), batch.map((word) => word.code).join("، ")],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const language = batch.language;
    const { level } = params<SentencesParams>(batch);
    const vocabulary = await loadVocabulary(tx, language);
    const seenInAnswer = new Map<string, number>();

    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["text"], index);
      const parsed = sentenceRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        round.rejected.push({ label, record, problems: zodProblems(parsed.error) });
        continue;
      }
      const sentence = parsed.data;
      const problems: Problem[] = [];
      if (sentence.targets.length === 0) problems.push(problem("noTargets"));

      const mapping = mapSentence(sentence, vocabulary);
      problems.push(...mapping.problems);

      const targetIds: number[] = [];
      for (const [k, target] of sentence.targets.entries()) {
        problems.push(...checkTarget(target, sentence.text, `targets[${k}]`));
        const id = await resolveTarget(tx, language, target, vocabulary);
        if (id === null) problems.push(problem("targetUnknown", { code: target.target }));
        else if (target.type === "word" && mapping.rows && !blankHoldsWord(target.marked_text, sentence.text, mapping.rows, id)) {
          problems.push(problem("blankNotTarget", { code: target.target, field: `targets[${k}].marked_text` }));
        }
        targetIds.push(id ?? 0);
      }
      if (problems.length > 0 || !mapping.rows) {
        round.rejected.push({ label, record, problems });
        continue;
      }
      round.warnings.push(...lengthFlags(label, { sentences: [sentence.text], options: targetOptions(sentence.targets) }));

      // The same sentence again: keep it, only add targets it does not have yet (PRD §14.9).
      const stored = await storeSentence(tx, batch, { sentence, rows: mapping.rows, vocabulary, level, label }, round, seenInAnswer);
      if (stored.isNew) round.added++;
      else round.skipped++;
      const sentenceId = stored.id;
      await addTargets(
        tx,
        batch,
        sentenceId,
        sentence.targets.map((target, k) => ({ type: target.type, id: targetIds[k], target })),
      );
      round.accepted.push({ label: sentence.text, entity: { type: "sentence", id: sentenceId }, record });
    }
    return round;
  },
};
