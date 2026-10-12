import type { PhonicsKind, Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { phonicsLessonRecord, type PhonicsLessonRecord } from "@/schemas/phonics";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { example, languageValues, params, trace } from "./shared";
import type { ContentKind } from "./types";

export type PlannedLesson = { label: string; kind: PhonicsKind };
type PhonicsParams = { level: string; label: string; kind: PhonicsKind; order_no: number };

const editable = new Set(["draft", "needs_review"]);
const openStates = ["prompt_made", "pasted"] as const;
const same = (a: string, b: string) => fold(a).replace(/\s+/g, " ").trim() === fold(b).replace(/\s+/g, " ").trim();

/** How many items each kind needs (PRD §8.1, §13.3). */
const sizes: Record<PhonicsKind, { words: [number, number]; pairs: number; sentences: number }> = {
  contrast: { words: [6, 10], pairs: 5, sentences: 0 },
  rule: { words: [8, 12], pairs: 0, sentences: 0 },
  liaison: { words: [0, 0], pairs: 0, sentences: 8 },
};

/** Lessons of the teacher's list (general settings) that have no lesson row yet, in order. */
export async function missingLessons(language: string) {
  const [planned, made, open] = await Promise.all([
    appSetting<PlannedLesson[]>(`phonics.lessons.${language}`),
    db.phonicsLesson.findMany({ where: { language }, select: { sound_label: true } }),
    db.importBatch.findMany({ where: { language, prompt_kind: "P_H", state: { in: [...openStates] } }, select: { params: true } }),
  ]);
  const taken = [...made.map((row) => row.sound_label), ...open.map((batch) => (batch.params as Partial<PhonicsParams> | null)?.label ?? "")];
  return planned
    .map((lesson, index) => ({ ...lesson, order_no: index + 1 }))
    .filter((lesson) => !taken.some((label) => same(label, lesson.label)));
}

/** Checks Zod cannot do: the counts of each kind and the wrong spellings (PRD §13.3). */
function checkLesson(lesson: PhonicsLessonRecord, kind: PhonicsKind): Problem[] {
  const problems: Problem[] = [];
  if (lesson.kind !== kind) problems.push(problem("badValue", { value: lesson.kind, field: "kind" }));
  const size = sizes[kind];
  if (kind !== "liaison") {
    const [min, max] = size.words;
    if (lesson.example_words.length < min) problems.push(problem("tooFew", { field: "example_words", min }));
    if (lesson.example_words.length > max) problems.push(problem("tooMany", { field: "example_words", max }));
    for (const word of lesson.example_words) {
      if (word.wrong_spellings.length !== 2) problems.push(problem("wrongSpellingsCount", { text: word.text }));
      else if (word.wrong_spellings.some((spelling) => same(spelling, word.text))) problems.push(problem("wrongSpellingSame", { text: word.text }));
      else if (same(word.wrong_spellings[0], word.wrong_spellings[1])) problems.push(problem("listRepeat", { field: "wrong_spellings" }));
    }
  }
  if (lesson.minimal_pairs.length < size.pairs) problems.push(problem("tooFew", { field: "minimal_pairs", min: size.pairs }));
  for (const pair of lesson.minimal_pairs) {
    if (same(pair.a, pair.b)) problems.push(problem("pairSame", { text: pair.a }));
  }
  if (lesson.liaison_sentences.length < size.sentences) problems.push(problem("tooFew", { field: "liaison_sentences", min: size.sentences }));
  for (const sentence of lesson.liaison_sentences) {
    const words = sentence.text.trim().split(/\s+/).length;
    if (sentence.liaison_after_word_index.some((index) => index >= words - 1)) problems.push(problem("liaisonIndex", { text: sentence.text }));
  }
  return problems;
}

/**
 * P-H (PRD §14.6): one phonics lesson, the next of the teacher's list. The lesson's name and kind come
 * from the list; the chatbot writes the tip, words, pairs and sentences. Only the lists of its kind are
 * stored (a rule lesson keeps no pairs, PRD §14.4).
 */
export const phonics: ContentKind = {
  kind: "P_H",
  template: "P-H.md",
  rootKey: "lesson",
  parts: [{ key: "lesson", single: true }],

  async plan(language) {
    const [next] = await missingLessons(language);
    if (!next) return { nothing: t("admin.create.nothing.phonics") };
    return {
      params: { level: "A1", label: next.label, kind: next.kind, order_no: next.order_no } satisfies PhonicsParams,
      values: { ...languageValues(language), label: next.label, kind: next.kind, example: example("P-H", language) },
      summary: [t("admin.create.summary.phonics", { label: next.label, kind: t(`admin.create.phonicsKinds.${next.kind}`) })],
      level: "A1",
    };
  },

  async importRecords(tx, batch, records, parts) {
    const round = emptyRound();
    const { label, kind, order_no } = params<PhonicsParams>(batch);
    for (const [index, record] of records.entries()) {
      const part = parts[index];
      const reject = (problems: Problem[]) => round.rejected.push({ label, record, problems, part });
      const parsed = phonicsLessonRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        reject(zodProblems(parsed.error));
        continue;
      }
      const lesson = parsed.data;
      const problems = checkLesson(lesson, kind);
      if (problems.length > 0) {
        reject(problems);
        continue;
      }
      const existing = (await tx.phonicsLesson.findMany({ where: { language: batch.language } })).find((row) => same(row.sound_label, label));
      if (existing && !editable.has(existing.status)) {
        reject([problem("locked", { code: label })]);
        continue;
      }
      const data = {
        kind,
        sound_label: label,
        order_no,
        graphemes: lesson.graphemes,
        tip_fa: lesson.tip_fa,
        example_words: (kind === "liaison" ? [] : lesson.example_words) as Prisma.InputJsonValue,
        minimal_pairs: (kind === "contrast" ? lesson.minimal_pairs : []) as Prisma.InputJsonValue,
        liaison_sentences: (kind === "liaison" ? lesson.liaison_sentences : []) as Prisma.InputJsonValue,
        ...trace(batch),
      };
      const saved = existing
        ? await tx.phonicsLesson.update({ where: { id: existing.id }, data })
        : await tx.phonicsLesson.create({ data: { language: batch.language, ...data } });
      if (existing) round.updated++;
      else round.added++;
      round.accepted.push({ label, entity: { type: "phonics_lesson", id: saved.id }, record, part });
    }
    return round;
  },
};
