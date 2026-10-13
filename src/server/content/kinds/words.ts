import type { Mastery, Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { wordRecord, type WordRecord } from "@/schemas/words";
import { db } from "@/server/db";
import { appSetting, engineNumber } from "@/server/settings/read";
import { lastIntroOrder, placeAfter } from "../intro-order";
import { languageInfo, type LanguageCode } from "../languages";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { batchSize, example, labelOf, languageValues, lines, params, trace } from "./shared";
import type { ContentKind, Tx } from "./types";

type WordsParams = { level: string; word_ids: number[] };

/** A draft made from the word list that still has no meaning (PRD §13.9). */
const skeleton = { meaning_fa: null, status: "draft", dup_of_id: null } as const;
const editable = new Set(["draft", "needs_review"]);
const lowLevels = new Set(["A1", "A2"]);

type Row = {
  id: number;
  code: string;
  lemma: string;
  pos: string;
  status: string;
  level: string;
  register: string;
  concept_id: number | null;
  mastery: Mastery;
  mastery_manual: boolean;
  frequency_rank: number | null;
  intro_order: number | null;
};

type Checked = { index: number; label: string; record: unknown; word: WordRecord; problems: Problem[] };

/** Language rules Zod cannot see (PRD §13.3, §14.2). Also fills defaults the PRD implies. */
function checkWord(word: WordRecord, language: LanguageCode): Problem[] {
  const problems: Problem[] = [];
  const genders: readonly string[] = languageInfo[language].genders;
  if (word.pos === "noun") {
    if (!word.gender) problems.push(problem("nounNeedsGender"));
    else if (!genders.includes(word.gender)) {
      problems.push(problem("genderForLanguage", { value: word.gender, allowed: genders.join("، ") }));
    }
    word.number ??= "sg";
    if (language === "de" && word.number === "sg" && !word.plural) problems.push(problem("germanPlural"));
  } else {
    // Gender and number belong to nouns only; anything else the chatbot sent is dropped.
    word.gender = null;
    word.number = null;
  }
  if (lowLevels.has(word.level) && word.mastery === "recognize") {
    problems.push(problem("masteryLowLevel", { field: "mastery" }));
  }
  if (word.pos === "phrase" && (!word.parts || word.parts.length === 0)) problems.push(problem("missing", { field: "parts" }));
  return problems;
}

/**
 * P-W (PRD §14.5): full records for the next 50 draft words of one level. Each answer record fills
 * its draft (matched by code, then lemma and pos); extra records (a colloquial twin, a new sense, a
 * split such as des / des-contr) become new words placed right after the word they belong to.
 */
export const words: ContentKind = {
  kind: "P_W",
  template: "P-W.md",
  rootKey: "words",

  async plan(language, options) {
    const levels = await appSetting<string[]>(`levels.${language}`);
    const pending = await db.word.groupBy({ by: ["level"], where: { language, ...skeleton }, _count: true });
    const withWork = new Set(pending.map((row) => row.level));
    const level =
      (options.level && withWork.has(options.level) ? options.level : null) ??
      levels.find((candidate) => withWork.has(candidate));
    if (!level) return { nothing: t("admin.create.nothing.words") };

    const size = await batchSize("P-W", 50);
    const batch = await db.word.findMany({
      where: { language, level, ...skeleton },
      orderBy: [{ intro_order: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: size,
    });
    const ids = new Set(batch.map((word) => word.id));
    const lemmas = new Set(batch.map((word) => fold(word.lemma)));
    const others = await db.word.findMany({
      where: { language, status: { not: "retired" } },
      select: { id: true, code: true, lemma: true, pos: true, meaning_fa: true, level: true },
    });
    const existing = others
      .filter((word) => !ids.has(word.id) && lemmas.has(fold(word.lemma)))
      .map((word) => [word.code, word.lemma, word.pos, word.meaning_fa ?? "—", word.level].join(" | "));

    return {
      params: { level, word_ids: batch.map((word) => word.id) } satisfies WordsParams,
      values: {
        ...languageValues(language),
        level,
        max: String(size),
        items: batch
          .map((word) => `${word.lemma} | ${word.pos} | no_card=${word.no_card}` + (word.parts.length > 0 ? ` | parts=${word.parts.join(", ")}` : ""))
          .join("\n"),
        existing: lines(existing),
        example: example("P-W", language),
      },
      summary: [
        t("admin.create.summary.words", { count: batch.length, level }),
        batch
          .slice(0, 8)
          .map((word) => word.lemma)
          .join("، ") + (batch.length > 8 ? "، …" : ""),
      ],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const language = batch.language as LanguageCode;
    const { word_ids } = params<WordsParams>(batch);
    const produceRank = await engineNumber("mastery.produce_rank");

    const rows: Row[] = await tx.word.findMany({
      where: { language },
      select: {
        id: true,
        code: true,
        lemma: true,
        pos: true,
        status: true,
        level: true,
        register: true,
        concept_id: true,
        mastery: true,
        mastery_manual: true,
        frequency_rank: true,
        intro_order: true,
      },
    });
    const byCode = new Map(rows.map((row) => [row.code, row]));
    const drafts = rows.filter((row) => word_ids.includes(row.id) && editable.has(row.status));
    const unmatched = new Set(drafts.map((row) => row.id));
    const concepts = new Map(
      (await tx.concept.findMany({ where: { language } })).map((concept) => [concept.id, concept.name_fa]),
    );

    // Pass 1: shape and language rules, record by record.
    const checked: Checked[] = [];
    const codeCount = new Map<string, number>();
    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["lemma", "code"], index);
      const parsed = wordRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        round.rejected.push({ label, record, problems: zodProblems(parsed.error) });
        continue;
      }
      const word = parsed.data;
      const problems = checkWord(word, language);
      codeCount.set(word.code, (codeCount.get(word.code) ?? 0) + 1);
      if ((codeCount.get(word.code) ?? 0) > 1) problems.push(problem("repeatedInAnswer", { code: word.code }));
      checked.push({ index, label, record, word, problems });
    }

    // Pass 2: references between words, which may point into this same answer.
    const answerCodes = new Map(checked.filter((item) => item.problems.length === 0).map((item) => [item.word.code, item.word]));
    for (const item of checked) {
      const { word } = item;
      if (word.parts) {
        const unknown = word.parts.filter((code) => !byCode.has(code) && !answerCodes.has(code));
        if (unknown.length > 0) item.problems.push(problem("partsUnknown", { codes: unknown.join("، ") }));
      }
      if (word.sense_of) {
        const base = byCode.get(word.sense_of) ?? answerCodes.get(word.sense_of);
        if (!base || fold(base.lemma) !== fold(word.lemma)) item.problems.push(problem("senseOfUnknown", { code: word.sense_of }));
      }
    }
    // A colloquial word needs a standard word with the same concept (PRD §13.3).
    const standardConcepts = new Set(
      rows.filter((row) => row.register === "standard" && row.concept_id).map((row) => concepts.get(row.concept_id!)),
    );
    for (const item of checked) {
      if (item.problems.length === 0 && item.word.register === "standard") standardConcepts.add(item.word.concept_fa);
    }
    for (const item of checked) {
      if (item.word.register !== "standard" && !standardConcepts.has(item.word.concept_fa)) {
        item.problems.push(problem("colloquialWithoutStandard", { code: item.word.code, concept: item.word.concept_fa }));
      }
    }

    // Pass 3: write, in answer order.
    const conceptIds = new Map([...concepts].map(([id, name]) => [name, id]));
    const nextOrder = new Map<string, number>();
    const moves = new Map<string, { wordId: number; afterId: number }[]>();
    let previous: Row | null = null;

    const orderAtEnd = async (level: string) => {
      if (!nextOrder.has(level)) nextOrder.set(level, await lastIntroOrder(tx, language, level));
      const order = nextOrder.get(level)! + 1;
      nextOrder.set(level, order);
      return order;
    };
    const conceptId = async (name: string) => {
      let id = conceptIds.get(name);
      if (id === undefined) {
        id = (await tx.concept.create({ data: { language, name_fa: name, ...trace(batch) } })).id;
        conceptIds.set(name, id);
      }
      return id;
    };

    for (const item of checked) {
      const { word, record, label } = item;
      if (item.problems.length > 0) {
        round.rejected.push({ label, record, problems: item.problems });
        continue;
      }
      const draft =
        drafts.find((row) => unmatched.has(row.id) && row.code === word.code) ??
        drafts.find((row) => unmatched.has(row.id) && fold(row.lemma) === fold(word.lemma) && row.pos === word.pos) ??
        (word.sense_of ? undefined : drafts.find((row) => unmatched.has(row.id) && fold(row.lemma) === fold(word.lemma)));
      const holder = byCode.get(word.code);
      let target: Row | undefined = draft;
      if (draft && holder && holder.id !== draft.id) {
        round.rejected.push({ label, record, problems: [problem("codeTaken", { code: word.code })] });
        continue;
      }
      if (!draft && holder) {
        if (!editable.has(holder.status)) {
          round.rejected.push({ label, record, problems: [problem("locked", { code: word.code })] });
          continue;
        }
        target = holder;
      }

      const sameLemma = rows.find((row) => row.id !== target?.id && fold(row.lemma) === fold(word.lemma));
      const isDuplicate = !target && !word.sense_of && fold(word.code) === fold(word.lemma) && Boolean(sameLemma);
      const rank = target?.frequency_rank ?? null;
      const mastery: Mastery = target?.mastery_manual
        ? target.mastery
        : lowLevels.has(word.level) || word.pos === "phrase"
          ? "produce"
          : rank !== null
            ? rank <= produceRank
              ? "produce"
              : "recognize"
            : (word.mastery ?? "produce");

      const data = {
        code: word.code,
        lemma: word.lemma,
        pos: word.pos,
        gender: word.gender,
        number: word.number,
        plural: word.plural,
        meaning_fa: word.meaning_fa,
        level: word.level,
        register: word.register,
        concept_id: await conceptId(word.concept_fa),
        no_card: word.no_card,
        homophones: word.homophones,
        note_fa: word.note_fa,
        mastery,
        mastery_suggested: word.mastery,
        sense_of: word.sense_of,
        parts: word.parts ?? [],
        family: word.family,
        collocations: word.collocations as Prisma.InputJsonValue,
        ...trace(batch),
      } as const;

      let saved: Row;
      if (target) {
        const intro_order = target.level === word.level ? target.intro_order : await orderAtEnd(word.level);
        saved = await updateWord(tx, target.id, { ...data, intro_order });
        unmatched.delete(target.id);
        round.updated++;
      } else {
        saved = await createWord(tx, {
          ...data,
          language,
          intro_order: await orderAtEnd(word.level),
          dup_of_id: isDuplicate ? sameLemma!.id : null,
        });
        round.added++;
        if (isDuplicate) round.duplicates++;
        const anchor = anchorFor(word, saved, previous, byCode);
        if (anchor) moves.set(saved.level, [...(moves.get(saved.level) ?? []), { wordId: saved.id, afterId: anchor.id }]);
      }
      if (target && target.code !== saved.code) byCode.delete(target.code);
      byCode.set(saved.code, saved);
      const index = rows.findIndex((row) => row.id === saved.id);
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      previous = saved;
      round.accepted.push({ label: word.lemma, entity: { type: "word", id: saved.id }, record });
    }

    for (const [level, list] of moves) await placeAfter(tx, language, level, list);
    for (const row of drafts) {
      if (unmatched.has(row.id)) round.warnings.push({ label: row.lemma, problem: problem("notReturned", { lemma: row.lemma }) });
    }
    return round;
  },
};

/** Where a new word goes in the order: after its base sense, its last part, or the record before it. */
function anchorFor(word: WordRecord, saved: Row, previous: Row | null, byCode: Map<string, Row>): Row | null {
  const sameLevel = (row: Row | undefined | null) => (row && row.level === saved.level && row.id !== saved.id ? row : null);
  if (word.sense_of) return sameLevel(byCode.get(word.sense_of));
  if (word.pos === "phrase" && word.parts) {
    const parts = word.parts.map((code) => sameLevel(byCode.get(code))).filter((row): row is Row => row !== null);
    if (parts.length > 0) return parts.reduce((last, row) => ((row.intro_order ?? 0) > (last.intro_order ?? 0) ? row : last));
  }
  return sameLevel(previous);
}

const rowSelect = {
  id: true,
  code: true,
  lemma: true,
  pos: true,
  status: true,
  level: true,
  register: true,
  concept_id: true,
  mastery: true,
  mastery_manual: true,
  frequency_rank: true,
  intro_order: true,
} as const;

function updateWord(tx: Tx, id: number, data: Prisma.WordUncheckedUpdateInput) {
  return tx.word.update({ where: { id }, data, select: rowSelect });
}

function createWord(tx: Tx, data: Prisma.WordUncheckedCreateInput) {
  return tx.word.create({ data, select: rowSelect });
}
