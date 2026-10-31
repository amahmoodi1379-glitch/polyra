import { z } from "zod";
import { CARD_REGISTERS, isCardRegister } from "@/engine/content";
import { fold } from "@/engine/tokens";
import { Prisma } from "@/generated/prisma/client";
import { spokenWord } from "@/lib/spoken";
import { filled, gender, grammaticalNumber, levelCode, mastery, optionalText, pos, register } from "@/schemas/common";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";
import { lastIntroOrder, rearrangeLevel } from "../../intro-order";
import type { Tx } from "../../kinds/types";
import { checkWord } from "../../kinds/words";
import { languageInfo, type LanguageCode } from "../../languages";
import { problem, type Problem } from "../../problems";
import { refreshSentenceLevels } from "../../sentence-level";
import { refreshDifficulty } from "../../text-difficulty";
import { levelOutside } from "../../kinds/shared";
import { errorsOf, logEdit, parseValues, staleAudio, textOrNull, wordInfo, type WordInfo } from "./shared";
import { viewOf, type Editor } from "./types";

const listOf = z.array(z.string()).transform((list) => list.map((item) => item.trim()).filter(Boolean));

const schema = z.object({
  lemma: filled,
  pos,
  gender: gender.nullable(),
  number: grammaticalNumber.nullable(),
  plural: optionalText,
  meaning_fa: optionalText,
  level: levelCode,
  register,
  concept_fa: optionalText,
  no_card: z.boolean(),
  mastery,
  homophones: listOf,
  note_fa: optionalText,
  family: optionalText,
  parts: listOf,
  sense_of: optionalText,
  collocations: z.array(z.object({ text: z.string(), translation_fa: z.string() })),
});
export type WordValues = z.output<typeof schema>;
export type SentenceUse = { id: number; text: string; translation_fa: string };
export type SenseChoice = { code: string; meaning_fa: string | null; level: string };
export type WordContext = {
  code: string;
  genders: string[];
  /** Other words with the same lemma: the ones this entry can be a new sense of (PRD §5.1). */
  senses: SenseChoice[];
  frequencyRank: number | null;
  masterySuggested: string | null;
  masteryManual: boolean;
  parts: Record<string, WordInfo>;
  targets: number;
  goal: number;
  sentences: SentenceUse[];
  tables: { id: number; tense: string }[];
};

/** Words of the list with this lemma (compared as PRD §13.3's duplicate check does), other than `id`. */
async function sameLemma(tx: Tx | typeof db, language: string, lemma: string, id: number) {
  const rows = await tx.word.findMany({
    where: { language, id: { not: id }, status: { not: "retired" }, lemma: { equals: lemma, mode: "insensitive" } },
    select: { code: true, lemma: true, meaning_fa: true, level: true, sense_of: true },
    orderBy: { id: "asc" },
  });
  return rows.filter((row) => fold(row.lemma) === fold(lemma));
}

/**
 * What keeps a new-sense link sound (PRD §5.1, §13.3): the base word has the same lemma and is not
 * itself, directly or along a chain, a new sense of this word; and a base word keeps the lemma of the
 * senses that point at it.
 */
async function senseProblems(tx: Tx, row: { id: number; code: string; language: string }, values: { lemma: string; sense_of: string | null }) {
  const problems: Problem[] = [];
  const others = await sameLemma(tx, row.language, values.lemma, row.id);
  const byCode = new Map(others.map((other) => [other.code, other]));
  if (values.sense_of) {
    const seen = new Set<string>();
    let at = byCode.get(values.sense_of);
    if (!at) problems.push(problem("senseOfUnknown", { code: values.sense_of, field: "sense_of" }));
    while (at?.sense_of && !seen.has(at.code)) {
      seen.add(at.code);
      if (at.sense_of === row.code) {
        problems.push(problem("senseOfLoop", { code: values.sense_of, field: "sense_of" }));
        break;
      }
      at = byCode.get(at.sense_of);
    }
  }
  const senses = await tx.word.findMany({ where: { language: row.language, sense_of: row.code, status: { not: "retired" } }, select: { code: true, lemma: true } });
  const apart = senses.filter((sense) => fold(sense.lemma) !== fold(values.lemma));
  if (apart.length > 0) problems.push(problem("senseLemmaApart", { codes: apart.map((sense) => sense.code).join("، "), field: "lemma" }));
  return problems;
}

/**
 * A word or phrase (PRD §5.1, §13.7): meaning, gender and plural apply at once; a level change puts
 * the word at the end of its new level, and a new level, parts or base word put it back after the
 * words it follows (PRD §5.8); turning «نوشتنی / شناختنی» by hand marks it «دستی» so the rank-based
 * default no longer changes it (PRD §13.4).
 */
export const wordEditor: Editor<WordValues, WordContext> = {
  async load(id) {
    const row = await db.word.findUnique({ where: { id }, include: { concept: true } });
    if (!row) return null;
    const [targets, goal, uses, tables, senses] = await Promise.all([
      db.sentenceTarget.count({ where: { target_type: "word", target_id: id, status: { not: "retired" } } }),
      engineNumber("publish.word_goal_targets"),
      db.sentenceWord.findMany({
        where: { word_id: id, sentence: { status: { not: "retired" } } },
        select: { sentence: { select: { id: true, text: true, translation_fa: true } } },
        distinct: ["sentence_id"],
        take: 12,
        orderBy: { sentence_id: "asc" },
      }),
      db.conjugationTable.findMany({ where: { word_id: id }, select: { id: true, tense: true }, orderBy: { id: "asc" } }),
      sameLemma(db, row.language, row.lemma, id),
    ]);
    return {
      language: row.language,
      view: viewOf(row, row.lemma, "target", row.level),
      values: {
        lemma: row.lemma,
        pos: row.pos,
        gender: row.gender as WordValues["gender"],
        number: row.number,
        plural: row.plural,
        meaning_fa: row.meaning_fa,
        level: row.level,
        register: row.register,
        concept_fa: row.concept?.name_fa ?? null,
        no_card: row.no_card,
        mastery: row.mastery,
        homophones: row.homophones,
        note_fa: row.note_fa,
        family: row.family,
        parts: row.parts,
        sense_of: row.sense_of,
        collocations: (row.collocations ?? []) as WordValues["collocations"],
      },
      context: {
        code: row.code,
        genders: [...languageInfo[row.language as LanguageCode].genders],
        senses: senses.map(({ code, meaning_fa, level }) => ({ code, meaning_fa, level })),
        frequencyRank: row.frequency_rank,
        masterySuggested: row.mastery_suggested,
        masteryManual: row.mastery_manual,
        parts: await wordInfo(row.language, row.parts),
        targets,
        goal,
        sentences: uses.map((use) => use.sentence),
        tables,
      },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = { ...parsed.values, parts: parsed.values.pos === "phrase" ? parsed.values.parts : [] };
    return db.$transaction(async (tx) => {
      const row = await tx.word.findUnique({ where: { id } });
      if (!row) return { state: "gone" as const };
      const language = row.language as LanguageCode;
      const problems: Problem[] = [...checkWord(values, language), ...(await levelOutside(language, values.level))];
      if (values.pos !== "noun") {
        values.gender = null;
        values.number = null;
        values.plural = null;
      }
      const collocations = values.collocations
        .map((pair) => ({ text: pair.text.trim(), translation_fa: pair.translation_fa.trim() }))
        .filter((pair) => pair.text || pair.translation_fa);
      collocations.forEach((pair, index) => {
        if (!pair.text || !pair.translation_fa) problems.push(problem("missing", { field: `collocations[${index}]` }));
      });
      if (collocations.length > 3) problems.push(problem("tooMany", { field: "collocations", max: 3 }));
      if (values.parts.length > 0) {
        const known = new Set((await tx.word.findMany({ where: { language, code: { in: values.parts } }, select: { code: true } })).map((word) => word.code));
        const unknown = values.parts.filter((code) => !known.has(code));
        if (unknown.length > 0) problems.push(problem("partsUnknown", { codes: unknown.join("، "), field: "parts" }));
      }
      // A word without meaning leaves the app, so a meaning can be changed but not cleared.
      if (row.meaning_fa && !values.meaning_fa) problems.push(problem("meaningCleared", { field: "meaning_fa" }));
      if (values.sense_of !== row.sense_of || fold(values.lemma) !== fold(row.lemma)) problems.push(...(await senseProblems(tx, row, values)));
      if (values.meaning_fa && !values.concept_fa) problems.push(problem("missing", { field: "concept_fa" }));
      if (!isCardRegister(values.register) && values.concept_fa) {
        const standard = await tx.word.count({
          where: { language, id: { not: id }, register: { in: [...CARD_REGISTERS] }, status: { not: "retired" }, concept: { name_fa: values.concept_fa } },
        });
        if (standard === 0) problems.push(problem("colloquialWithoutStandard", { code: row.code, concept: values.concept_fa, field: "concept_fa" }));
      }
      if (problems.length > 0) return { state: "invalid" as const, errors: errorsOf(problems) };

      let conceptId: number | null = null;
      if (values.concept_fa) {
        const concept = await tx.concept.upsert({
          where: { language_name_fa: { language, name_fa: values.concept_fa } },
          create: { language, name_fa: values.concept_fa },
          update: {},
        });
        conceptId = concept.id;
      }
      const data = {
        lemma: values.lemma,
        pos: values.pos,
        gender: values.gender,
        number: values.number,
        plural: textOrNull(values.plural),
        meaning_fa: values.meaning_fa,
        level: values.level,
        register: values.register,
        concept_id: conceptId,
        no_card: values.no_card,
        mastery: values.mastery,
        mastery_manual: row.mastery_manual || values.mastery !== row.mastery,
        homophones: values.homophones,
        note_fa: values.note_fa,
        family: values.family,
        parts: values.parts,
        sense_of: values.sense_of,
        // An empty list keeps its stored form ([] from import, null from earlier edits), so it is no change.
        collocations: collocations.length > 0 ? collocations : Array.isArray(row.collocations) ? [] : null,
        intro_order: values.level !== row.level ? (await lastIntroOrder(tx, language, values.level)) + 1 : row.intro_order,
      };
      if (await logEdit(tx, adminId, "words", id, row, data)) {
        await tx.word.update({ where: { id }, data: { ...data, collocations: data.collocations ?? Prisma.DbNull } });
        // The audio says the word with its article (src/lib/spoken.ts); a new spoken form makes it stale.
        if (spokenWord({ ...row, ...data }) !== spokenWord(row)) await staleAudio(tx, [row.audio_id, row.human_audio_id]);
        if (values.level !== row.level || values.sense_of !== row.sense_of || values.parts.join() !== row.parts.join()) await rearrangeLevel(tx, language, values.level);
        if (values.level !== row.level) {
          await refreshSentenceLevels(tx, { wordIds: [id] });
          await refreshDifficulty(tx, { wordIds: [id] });
        }
      }
      return { state: "saved" as const, values: { ...values, collocations }, notes: [] };
    });
  },
};
