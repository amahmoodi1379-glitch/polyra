import { z } from "zod";
import { Prisma, type ContentStatus, type QuestionSet, type QuestionType, type Track as TrackName } from "@/generated/prisma/client";
import { t } from "@/i18n";
import { filled } from "@/schemas/common";
import type { QuestionRecord } from "@/schemas/texts";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import type { Tx } from "../../kinds/types";
import { problem, type Problem } from "../../problems";
import { plain, same } from "../log";
import { allowedTypes, checkQuestionSets, questionRange, setNames, tracks, type SetName, type Track } from "../../text-check";
import { errorsOf, logEdit, parseValues, staleAudio, wordInfo, type WordInfo } from "./shared";
import { viewOf, type Editor } from "./types";

type TextKindEntry = { kind: string; name_fa: string; speakers: boolean };

/** One question as the form edits it: its stored id (new ones have none) and its fields. */
export type QuestionEdit = QuestionRecord & { id: number | null };
export type QuestionSets = Record<Track, Record<SetName, QuestionEdit[]>>;

const questionList = z.array(z.looseObject({ id: z.number().int().nullable().optional(), type: z.string() }));
const schema = z.object({
  title: filled,
  placement_ok: z.boolean(),
  key_words: z.array(z.string()).transform((list) => [...new Set(list.map((code) => code.trim()).filter(Boolean))]),
  speakers: z.array(z.string().nullable()).nullable(),
  question_sets: z.object({
    reading: z.object({ A: questionList, B: questionList }),
    listening: z.object({ A: questionList, B: questionList }),
  }),
});
export type TextValues = { title: string; placement_ok: boolean; key_words: string[]; speakers: (string | null)[] | null; question_sets: QuestionSets };

export type TextSentenceLine = { id: number; text: string; translation_fa: string; status: string; hasNumber: boolean; open: number };
export type TextContext = {
  code: string;
  band: number;
  kind: string;
  kindName: string;
  hasSpeakers: boolean;
  wordCount: number | null;
  sentences: TextSentenceLine[];
  words: Record<string, WordInfo>;
  /** Words of the list that appear in the text, for choosing key words. */
  textWords: WordInfo[];
  allowed: Record<Track, QuestionRecord["type"][]>;
  ranges: Record<Track, Record<SetName, [number, number]>>;
  audio: { stale: boolean; has: boolean };
};

export type StoredQuestion = { id: number; track: TrackName; set: QuestionSet; order_no: number; type: QuestionType; payload: unknown; explanation_fa: string | null; status: ContentStatus };

const questionColumns = { id: true, track: true, set: true, order_no: true, type: true, payload: true, explanation_fa: true, status: true } as const;
export const comparable = (rows: StoredQuestion[]) =>
  rows.map(({ id, track, set, order_no, type, payload, explanation_fa, status }) => ({ id, track, set, order_no, type, payload, explanation_fa, status }));

function questionSetsOf(rows: StoredQuestion[]): QuestionSets {
  const sets: QuestionSets = { reading: { A: [], B: [] }, listening: { A: [], B: [] } };
  for (const row of [...rows].sort((a, b) => a.order_no - b.order_no)) {
    const payload = row.payload as Record<string, unknown>;
    sets[row.track][row.set].push({ ...payload, type: row.type, explanation_fa: row.explanation_fa, prompt_fa: (payload.prompt_fa as string | undefined) ?? null, id: row.id } as QuestionEdit);
  }
  return sets;
}

async function textSentences(tx: Tx | typeof db, ids: number[]) {
  const rows = await tx.sentence.findMany({
    where: { id: { in: ids } },
    select: { id: true, text: true, translation_fa: true, status: true, words: { select: { kind: true, word_id: true, candidate_reason: true, suspect: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

/**
 * A text (PRD §7, §13.2): title, placement, key words, speakers and its four question sets, with the
 * same checks as import (PRD §13.3). Sentences are edited on their own page. Editing the questions of
 * a published text makes its audio stale and suspends it until new audio comes (PRD §13.7).
 */
export const textEditor: Editor<TextValues, TextContext> = {
  async load(id) {
    const row = await db.text.findUnique({ where: { id }, include: { questions: { where: { status: { not: "retired" } }, select: questionColumns } } });
    if (!row) return null;
    const [kinds, sentences, audio] = await Promise.all([
      appSetting<Record<string, TextKindEntry[]>>("prompt.text_kinds"),
      textSentences(db, row.sentence_ids),
      row.audio_id ? db.audioAsset.findUnique({ where: { id: row.audio_id }, select: { stale: true } }) : null,
    ]);
    const kind = (kinds[String(row.band)] ?? []).find((entry) => entry.kind === row.kind);
    const wordIds = [...new Set(sentences.flatMap((sentence) => sentence.words.map((word) => word.word_id)).filter((wordId): wordId is number => wordId !== null))];
    const listWords = await db.word.findMany({ where: { id: { in: [...wordIds, ...row.key_word_ids] } }, select: { id: true, code: true, lemma: true, meaning_fa: true, level: true, pos: true } });
    const codeOf = new Map(listWords.map((word) => [word.id, word.code]));
    const keyWords = row.key_word_ids.map((wordId) => codeOf.get(wordId)).filter((code): code is string => Boolean(code));
    const speakers = (row.speakers ?? null) as (string | null)[] | null;
    return {
      language: row.language,
      view: viewOf(row, row.title, "target", row.level),
      values: {
        title: row.title,
        placement_ok: row.placement_ok,
        key_words: keyWords,
        speakers: kind?.speakers ? row.sentence_ids.map((_, index) => speakers?.[index] ?? null) : null,
        question_sets: questionSetsOf(row.questions),
      },
      context: {
        code: row.code,
        band: row.band,
        kind: row.kind,
        kindName: kind?.name_fa ?? row.kind,
        hasSpeakers: Boolean(kind?.speakers),
        wordCount: row.word_count,
        sentences: sentences.map((sentence) => ({
          id: sentence.id,
          text: sentence.text,
          translation_fa: sentence.translation_fa,
          status: sentence.status,
          hasNumber: sentence.words.some((word) => word.kind === "number"),
          open: sentence.words.filter((word) => word.candidate_reason || word.suspect).length,
        })),
        words: await wordInfo(row.language, keyWords),
        textWords: listWords.filter((word) => wordIds.includes(word.id)).sort((a, b) => a.lemma.localeCompare(b.lemma)),
        allowed: { reading: allowedTypes("reading", row.band), listening: allowedTypes("listening", row.band) },
        ranges: Object.fromEntries(
          tracks.map((track) => [track, Object.fromEntries(setNames.map((set) => [set, questionRange(row.band, set, row.placement_ok)]))]),
        ) as TextContext["ranges"],
        audio: { stale: Boolean(audio?.stale), has: Boolean(row.audio_id || row.human_audio_id) },
      },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = parsed.values;
    return db.$transaction(async (tx) => {
      const row = await tx.text.findUnique({ where: { id }, include: { questions: { where: { status: { not: "retired" } }, select: questionColumns } } });
      if (!row) return { state: "gone" as const };
      const kinds = await appSetting<Record<string, TextKindEntry[]>>("prompt.text_kinds");
      const kind = (kinds[String(row.band)] ?? []).find((entry) => entry.kind === row.kind);
      const sentences = await textSentences(tx, row.sentence_ids);
      const problems: Problem[] = [];

      // Speakers: a conversation needs a name on every line and at least two people (PRD §7.2).
      let speakers: (string | null)[] | null = null;
      if (kind?.speakers) {
        speakers = row.sentence_ids.map((_, index) => values.speakers?.[index]?.trim() || null);
        speakers.forEach((speaker, index) => {
          if (!speaker) problems.push(problem("missing", { field: `speakers[${index}]` }));
        });
        if (speakers.every(Boolean) && new Set(speakers).size < 2) problems.push(problem("speakers", { field: "speakers" }));
      }

      // Key words: at most five, each a list word that appears in this text (PRD §14.3).
      if (values.key_words.length > 5) problems.push(problem("tooMany", { field: "key_words", max: 5 }));
      const inText = new Set(sentences.flatMap((sentence) => sentence.words.map((word) => word.word_id)).filter((wordId): wordId is number => wordId !== null));
      const keyRows = await tx.word.findMany({ where: { language: row.language, code: { in: values.key_words } }, select: { id: true, code: true } });
      const keyWordIds: number[] = [];
      for (const code of values.key_words) {
        const word = keyRows.find((item) => item.code === code);
        if (word && inText.has(word.id)) keyWordIds.push(word.id);
        else problems.push(problem("keyWordNotInText", { code, field: "key_words" }));
      }

      // Questions: the same checks as import, on the text's band and placement.
      const sets = values.question_sets as unknown as Record<Track, Record<SetName, unknown[]>>;
      const checked = checkQuestionSets(sets, {
        band: row.band,
        placement: values.placement_ok,
        sentences: sentences.map((sentence) => ({ text: sentence.text, tokens: sentence.words.map((word) => ({ kind: word.kind })) })),
      });
      problems.push(...checked.problems);
      if (problems.length > 0) return { state: "invalid" as const, errors: errorsOf(problems) };

      // Questions keep their id when edited; removed ones are deleted while the text is a draft and set
      // aside (retired) after that, so the answers already given keep pointing at them.
      const known = new Map(row.questions.map((question) => [question.id, question]));
      const kept = new Set<number>();
      const next: StoredQuestion[] = [];
      for (const { track, set, order_no, question } of checked.questions) {
        const { type, explanation_fa, prompt_fa, ...rest } = question;
        const payload = plain(prompt_fa ? { ...rest, prompt_fa } : rest);
        const formId = (values.question_sets[track][set][order_no - 1] as { id?: number | null }).id ?? null;
        const old = formId !== null ? known.get(formId) : undefined;
        const fields = { track, set, order_no, type, payload, explanation_fa: explanation_fa ?? null };
        if (old && !kept.has(old.id)) {
          kept.add(old.id);
          next.push({ ...old, ...fields });
        } else {
          next.push({ id: 0, status: row.status, ...fields });
        }
      }
      const removed = row.questions.filter((question) => !kept.has(question.id));
      const questionsChanged =
        removed.length > 0 || next.some((question) => question.id === 0 || !same(comparable([question]), comparable([known.get(question.id)!])));

      const draftLike = row.status === "draft" || row.status === "needs_review";
      const suspend = questionsChanged && row.status === "published";
      const data = { title: values.title, placement_ok: values.placement_ok, key_word_ids: keyWordIds, speakers, ...(suspend ? { suspended: true } : {}) };
      let extra: { before: Record<string, unknown>; after: Record<string, unknown> } | undefined;
      if (questionsChanged) {
        for (const question of removed) {
          if (draftLike) await tx.question.delete({ where: { id: question.id } });
          else await tx.question.update({ where: { id: question.id }, data: { status: "retired" } });
        }
        for (const question of next) {
          const fields = {
            track: question.track,
            set: question.set,
            order_no: question.order_no,
            type: question.type as QuestionType,
            payload: question.payload as Prisma.InputJsonValue,
            explanation_fa: question.explanation_fa,
          };
          if (question.id) await tx.question.update({ where: { id: question.id }, data: fields });
          else question.id = (await tx.question.create({ data: { language: row.language, text_id: id, status: row.status, ...fields } })).id;
        }
        // The log keeps every question before and after, so «برگردان» can put the old ones back.
        const after = [...comparable(next), ...(draftLike ? [] : comparable(removed).map((question) => ({ ...question, status: "retired" })))];
        extra = { before: { question: comparable(row.questions) }, after: { question: after } };
      }
      if (await logEdit(tx, adminId, "texts", id, row, data, extra)) {
        await tx.text.update({ where: { id }, data: { ...data, speakers: speakers ?? Prisma.DbNull } });
        if (suspend) await staleAudio(tx, [row.audio_id, row.human_audio_id]);
      }
      const codes = new Map(keyRows.map((word) => [word.id, word.code]));
      return {
        state: "saved" as const,
        values: { ...values, speakers, key_words: keyWordIds.map((wordId) => codes.get(wordId)!), question_sets: questionSetsOf(next) },
        notes: suspend ? [t("admin.library.form.textSuspended")] : [],
      };
    });
  },
};
