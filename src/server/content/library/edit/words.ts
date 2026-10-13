import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { spokenWord } from "@/lib/spoken";
import { filled, gender, grammaticalNumber, levelCode, mastery, optionalText, pos, register } from "@/schemas/common";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";
import { lastIntroOrder, rearrangeLevel } from "../../intro-order";
import { checkWord } from "../../kinds/words";
import { languageInfo, type LanguageCode } from "../../languages";
import { problem, type Problem } from "../../problems";
import { refreshDifficulty } from "../../text-difficulty";
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
  collocations: z.array(z.object({ text: z.string(), translation_fa: z.string() })),
});
export type WordValues = z.output<typeof schema>;
export type SentenceUse = { id: number; text: string; translation_fa: string };
export type WordContext = {
  code: string;
  genders: string[];
  senseOf: string | null;
  frequencyRank: number | null;
  masterySuggested: string | null;
  masteryManual: boolean;
  parts: Record<string, WordInfo>;
  targets: number;
  goal: number;
  sentences: SentenceUse[];
  tables: { id: number; tense: string }[];
};

/**
 * A word or phrase (PRD §5.1, §13.7): meaning, gender and plural apply at once; a level change puts
 * the word at the end of its new level; turning «نوشتنی / شناختنی» by hand marks it «دستی» so the
 * rank-based default no longer changes it (PRD §13.4).
 */
export const wordEditor: Editor<WordValues, WordContext> = {
  async load(id) {
    const row = await db.word.findUnique({ where: { id }, include: { concept: true } });
    if (!row) return null;
    const [targets, goal, uses, tables] = await Promise.all([
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
        collocations: (row.collocations ?? []) as WordValues["collocations"],
      },
      context: {
        code: row.code,
        genders: [...languageInfo[row.language as LanguageCode].genders],
        senseOf: row.sense_of,
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
      const problems: Problem[] = checkWord(values, language);
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
      if (values.meaning_fa && !values.concept_fa) problems.push(problem("missing", { field: "concept_fa" }));
      if (values.register !== "standard" && values.concept_fa) {
        const standard = await tx.word.count({
          where: { language, id: { not: id }, register: "standard", status: { not: "retired" }, concept: { name_fa: values.concept_fa } },
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
        // An empty list keeps its stored form ([] from import, null from earlier edits), so it is no change.
        collocations: collocations.length > 0 ? collocations : Array.isArray(row.collocations) ? [] : null,
        intro_order: values.level !== row.level ? (await lastIntroOrder(tx, language, values.level)) + 1 : row.intro_order,
      };
      if (await logEdit(tx, adminId, "words", id, row, data)) {
        await tx.word.update({ where: { id }, data: { ...data, collocations: data.collocations ?? Prisma.DbNull } });
        // The audio says the word with its article (src/lib/spoken.ts); a new spoken form makes it stale.
        if (spokenWord({ ...row, ...data }) !== spokenWord(row)) await staleAudio(tx, [row.audio_id, row.human_audio_id]);
        if (values.level !== row.level) {
          await rearrangeLevel(tx, language, values.level);
          await refreshDifficulty(tx, { wordIds: [id] });
        }
      }
      return { state: "saved" as const, values: { ...values, collocations }, notes: [] };
    });
  },
};
