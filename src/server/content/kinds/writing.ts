import { t } from "@/i18n";
import { writingRecord, type WritingRecord } from "@/schemas/speaking";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { allowedWords } from "./allowed";
import { batchSize, example, labelOf, languageValues, lines, params, trace } from "./shared";
import { nextLevel, openStates, unitLines, wordCount, type LevelNext } from "./targets";
import type { ContentKind } from "./types";

type WritingParams = { level: string; count: number };
export type Range = [number, number];

const editable = new Set(["draft", "needs_review"]);
/** PRD §8b.6: 3 to 5 checklist items, 4 to 6 useful phrases. */
const CHECKLIST: Range = [3, 5];
const PHRASES: Range = [4, 6];
const same = (text: string) => text.replace(/\s+/g, " ").trim();

/** The rules of one task (PRD §8b.6, §13.3), for import and for the edit form. */
export function checkWriting(task: Pick<WritingRecord, "min_words" | "max_words" | "checklist_fa" | "useful_phrases" | "model_answer">, range: Range) {
  const problems: Problem[] = [];
  if (task.min_words < range[0] || task.max_words > range[1] || task.min_words >= task.max_words) {
    problems.push(problem("wordRange", { min: range[0], max: range[1] }));
  }
  if (task.checklist_fa.length < CHECKLIST[0]) problems.push(problem("tooFew", { field: "checklist_fa", min: CHECKLIST[0] }));
  if (task.checklist_fa.length > CHECKLIST[1]) problems.push(problem("tooMany", { field: "checklist_fa", max: CHECKLIST[1] }));
  if (task.useful_phrases.length < PHRASES[0]) problems.push(problem("tooFew", { field: "useful_phrases", min: PHRASES[0] }));
  if (task.useful_phrases.length > PHRASES[1]) problems.push(problem("tooMany", { field: "useful_phrases", max: PHRASES[1] }));
  const words = wordCount(task.model_answer);
  if (words < task.min_words || words > task.max_words) {
    problems.push(problem("modelLength", { count: words, min: task.min_words, max: task.max_words }));
  }
  return problems;
}

/** Word range of a level's writing tasks (PRD §8b.6), from the general settings. */
export async function writingRange(level: string): Promise<Range> {
  return (await appSetting<Record<string, Range>>("prompt.writing_words"))[level] ?? [60, 120];
}

async function writingCounts(language: string) {
  const [made, open] = await Promise.all([
    db.writingTask.groupBy({ by: ["level"], where: { language, status: { not: "retired" } }, _count: true }),
    db.importBatch.findMany({ where: { language, prompt_kind: "P_WR", state: { in: [...openStates] } }, select: { params: true } }),
  ]);
  const counts = new Map(made.map((row) => [row.level, row._count]));
  for (const batch of open) {
    const { level, count } = batch.params as WritingParams;
    counts.set(level, (counts.get(level) ?? 0) + count);
  }
  return counts;
}

/** The next guided-writing batch (PRD §8b.7: B1 and B2), or what it waits for. */
export async function nextWriting(language: string, wanted?: string): Promise<LevelNext> {
  return nextLevel(language, "writing", await writingCounts(language), { wanted, size: await batchSize("P-WR", 5) });
}

/**
 * P-WR (PRD §14.6, §8b.6): guided writing tasks with a checklist, useful phrases and a model answer.
 * A task is the same task when its level and Persian prompt are the same (PRD §14.9).
 */
export const writing: ContentKind = {
  kind: "P_WR",
  template: "P-WR.md",
  rootKey: "tasks",

  async plan(language, options) {
    const next = await nextWriting(language, options.level);
    if (next.state === "done") return { nothing: t("admin.create.nothing.writing") };
    if (next.state === "needsUnits") return { nothing: t("admin.create.kinds.writing.needsUnits", { level: next.level }) };
    if (next.state === "needsWords") return { nothing: t("admin.create.kinds.writing.needsWords", { level: next.level }) };
    const { level, size } = next;
    const range = await writingRange(level);
    const made = await db.writingTask.findMany({ where: { language, level, status: { not: "retired" } }, select: { prompt_fa: true } });
    return {
      params: { level, count: size } satisfies WritingParams,
      values: {
        ...languageValues(language),
        level,
        count: String(size),
        min: String(range[0]),
        max: String(range[1]),
        allowed: await allowedWords(language, { level }),
        units: lines(await unitLines(language, level)),
        existing: lines(made.map((row) => row.prompt_fa)),
        example: example("P-WR", language),
      },
      summary: [t("admin.create.summary.writing", { count: size, level })],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const language = batch.language;
    const { level } = params<WritingParams>(batch);
    const range = await writingRange(level);
    const seen = new Set<string>();

    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["prompt_fa"], index);
      const parsed = writingRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        round.rejected.push({ label, record, problems: zodProblems(parsed.error) });
        continue;
      }
      const task = parsed.data;
      const problems: Problem[] = [];
      const key = same(task.prompt_fa);
      if (seen.has(key)) problems.push(problem("repeatedInAnswer", { code: task.prompt_fa }));
      if (task.level !== level) problems.push(problem("levelMismatch", { value: task.level, level }));
      problems.push(...checkWriting(task, range));
      const existing = await tx.writingTask.findFirst({ where: { language, level, prompt_fa: task.prompt_fa } });
      if (existing && !editable.has(existing.status)) problems.push(problem("locked", { code: task.prompt_fa }));
      if (problems.length > 0) {
        round.rejected.push({ label, record, problems });
        continue;
      }
      seen.add(key);

      const data = {
        min_words: task.min_words,
        max_words: task.max_words,
        checklist_fa: task.checklist_fa,
        useful_phrases: task.useful_phrases,
        model_answer: task.model_answer,
        model_answer_fa: task.model_answer_fa,
        ...trace(batch),
      };
      const saved = existing
        ? await tx.writingTask.update({ where: { id: existing.id }, data })
        : await tx.writingTask.create({ data: { language, level, prompt_fa: task.prompt_fa, ...data } });
      if (existing) round.updated++;
      else round.added++;
      round.accepted.push({ label: task.prompt_fa, entity: { type: "writing_task", id: saved.id }, record });
    }
    return round;
  },
};
