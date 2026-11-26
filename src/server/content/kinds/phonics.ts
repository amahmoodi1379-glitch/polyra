import type { PhonicsKind, Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { phonicsLessonRecord } from "@/schemas/phonics";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { checkLesson } from "../phonics-check";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { updateImported } from "./hand-edits";
import { example, languageValues, params, texts, trace } from "./shared";
import { openParams } from "./targets";
import type { ContentKind, Tx } from "./types";

export { checkLesson };
export type PlannedLesson = { label: string; kind: PhonicsKind };
type PhonicsParams = { level: string; label: string; kind: PhonicsKind; order_no: number };

const editable = new Set(["draft", "needs_review"]);
const same = (a: string, b: string) => fold(a).replace(/\s+/g, " ").trim() === fold(b).replace(/\s+/g, " ").trim();

/** Lessons of the teacher's list (general settings) that have no lesson row yet, in order. */
export async function missingLessons(language: string) {
  const [planned, made, open] = await Promise.all([
    appSetting<PlannedLesson[]>(`phonics.lessons.${language}`),
    db.phonicsLesson.findMany({ where: { language }, select: { sound_label: true } }),
    openParams<PhonicsParams>(language, "P_H"),
  ]);
  const taken = [...made.map((row) => row.sound_label), ...open.map((params) => params.label ?? "")];
  return planned
    .map((lesson, index) => ({ ...lesson, order_no: index + 1 }))
    .filter((lesson) => !taken.some((label) => same(label, lesson.label)));
}

/**
 * Labels renamed in place in the teacher's list: the list keeps its length and at one place an old
 * label is gone and a new one came. Lessons are matched to the list by label, so a renamed entry
 * renames its lesson too; otherwise the planner would offer the made lesson again.
 */
export function renamedLessons(before: PlannedLesson[], after: PlannedLesson[]): { from: string; to: string }[] {
  if (before.length !== after.length) return [];
  return before.flatMap((old, index) => {
    const next = after[index];
    const gone = !after.some((lesson) => same(lesson.label, old.label));
    const fresh = !before.some((lesson) => same(lesson.label, next.label));
    return gone && fresh ? [{ from: old.label, to: next.label }] : [];
  });
}

/** Gives the lessons of these renamed list entries their new labels. */
export async function renameLessonRows(tx: Tx, language: string, renames: { from: string; to: string }[]) {
  if (renames.length === 0) return;
  const rows = await tx.phonicsLesson.findMany({ where: { language }, select: { id: true, sound_label: true } });
  for (const { from, to } of renames) {
    for (const row of rows.filter((lesson) => same(lesson.sound_label, from))) await tx.phonicsLesson.update({ where: { id: row.id }, data: { sound_label: to } });
  }
}

/** The teacher's list with one entry renamed, or null when no entry has that label. */
export function renameInList(list: PlannedLesson[], from: string, to: string): PlannedLesson[] | null {
  if (!list.some((lesson) => same(lesson.label, from))) return null;
  return list.map((lesson) => (same(lesson.label, from) ? { ...lesson, label: to } : lesson));
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
  /** The lesson is for this batch's sound, when the answer names one. */
  matches: (batch, answer) => {
    const [label] = texts(answer.lesson, ["sound_label"]);
    return label === undefined || same(label, params<PhonicsParams>(batch).label);
  },

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

  async importRecords(tx, batch, records, parts, by) {
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
        ? await updateImported(tx, { by, round, label, ref: { type: "phonics_lesson", id: existing.id } }, existing, data, (write) => tx.phonicsLesson.update({ where: { id: existing.id }, data: write }))
        : await tx.phonicsLesson.create({ data: { language: batch.language, ...data } });
      if (!existing) round.added++;
      round.accepted.push({ label, entity: { type: "phonics_lesson", id: saved.id }, record, part });
    }
    return round;
  },
};
