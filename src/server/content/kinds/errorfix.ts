import type { Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { errorfixRecord } from "@/schemas/speaking";
import { db } from "@/server/db";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { loadVocabulary } from "../vocabulary";
import { allowedWords } from "./allowed";
import { mapSentence, tidy } from "./sentence-store";
import { batchSize, example, labelOf, languageValues, lines, params, trace } from "./shared";
import { nextLevel, openStates, unitLines, type LevelNext } from "./targets";
import type { ContentKind } from "./types";

type ErrorfixParams = { level: string; count: number };

/** PRD §8b.5: 2 or 3 mistakes, each one word, marked {{wrong|right}}. */
const MARKS: [number, number] = [2, 3];
const markPattern = /\{\{([^{}|]*)\|([^{}|]*)\}\}/g;
const oneWord = (text: string) => text.trim() !== "" && !/\s/.test(text.trim());

/** The text with every mistake corrected: what the learner should end with. */
export function correctedText(marked: string) {
  return marked.replace(markPattern, (_, __, right: string) => right.trim());
}

async function errorfixCounts(language: string) {
  const [made, open] = await Promise.all([
    db.errorfixItem.groupBy({ by: ["level"], where: { language, status: { not: "retired" } }, _count: true }),
    db.importBatch.findMany({ where: { language, prompt_kind: "P_E", state: { in: [...openStates] } }, select: { params: true } }),
  ]);
  const counts = new Map(made.map((row) => [row.level, row._count]));
  for (const batch of open) {
    const { level, count } = batch.params as ErrorfixParams;
    counts.set(level, (counts.get(level) ?? 0) + count);
  }
  return counts;
}

/** The next find-the-mistake batch (PRD §8b.7: B1 and B2), or what it waits for. */
export async function nextErrorfix(language: string, wanted?: string): Promise<LevelNext> {
  return nextLevel(language, "errorfix", await errorfixCounts(language), { wanted, size: await batchSize("P-E", 5) });
}

/**
 * P-E (PRD §14.6, §8b.5): short texts with two or three real mistakes of Persian speakers. The word
 * mapping is of the corrected text; the same corrected text is never stored twice (PRD §14.9).
 */
export const errorfix: ContentKind = {
  kind: "P_E",
  template: "P-E.md",
  rootKey: "items",

  async plan(language, options) {
    const next = await nextErrorfix(language, options.level);
    if (next.state === "done") return { nothing: t("admin.create.nothing.errorfix") };
    if (next.state === "needsUnits") return { nothing: t("admin.create.kinds.errorfix.needsUnits", { level: next.level }) };
    if (next.state === "needsWords") return { nothing: t("admin.create.kinds.errorfix.needsWords", { level: next.level }) };
    const { level, size } = next;
    return {
      params: { level, count: size } satisfies ErrorfixParams,
      values: {
        ...languageValues(language),
        level,
        count: String(size),
        units: lines(await unitLines(language, level)),
        allowed: await allowedWords(language, { level }),
        example: example("P-E", language),
      },
      summary: [t("admin.create.summary.errorfix", { count: size, level })],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const language = batch.language;
    const { level } = params<ErrorfixParams>(batch);
    const vocabulary = await loadVocabulary(tx, language);
    const units = new Set((await tx.grammarUnit.findMany({ where: { language }, select: { unit_code: true } })).map((unit) => unit.unit_code));
    const key = (text: string) => fold(tidy(text));
    const stored = new Set(
      (await tx.errorfixItem.findMany({ where: { language }, select: { marked_text: true } })).map((row) => key(correctedText(row.marked_text))),
    );

    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["marked_text"], index);
      const parsed = errorfixRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        round.rejected.push({ label, record, problems: zodProblems(parsed.error) });
        continue;
      }
      const item = parsed.data;
      const problems: Problem[] = [];
      if (item.level !== level) problems.push(problem("levelMismatch", { value: item.level, level }));
      const marks = [...item.marked_text.matchAll(markPattern)].map(([, wrong, right]) => ({ wrong: wrong.trim(), right: right.trim() }));
      if (marks.length < MARKS[0] || marks.length > MARKS[1]) problems.push(problem("marksCount", { field: "marked_text", count: marks.length }));
      for (const mark of marks) {
        if (!oneWord(mark.wrong) || !oneWord(mark.right) || fold(mark.wrong) === fold(mark.right)) {
          problems.push(problem("markInvalid", { text: `${mark.wrong}|${mark.right}` }));
        }
      }
      if (marks.length > 0 && item.errors.length !== marks.length) problems.push(problem("errorsCount", { count: item.errors.length, expected: marks.length }));
      const unknown = item.unit_codes.filter((code) => !units.has(code));
      for (const code of unknown) problems.push(problem("unitUnknown", { code }));
      const text = correctedText(item.marked_text);
      const mapped = mapSentence({ text, tokens: item.tokens }, vocabulary);
      problems.push(...mapped.problems);
      if (problems.length > 0 || !mapped.rows) {
        round.rejected.push({ label, record, problems });
        continue;
      }

      if (stored.has(key(text))) {
        round.skipped++;
        continue;
      }
      stored.add(key(text));
      const unknownWords = mapped.rows.filter((row) => row.kind === "word" && (!row.word_id || row.candidate_reason)).length;
      if (unknownWords > 0) round.warnings.push({ label: text, problem: problem("unknownWords", { count: unknownWords }) });
      const created = await tx.errorfixItem.create({
        data: {
          language,
          level,
          marked_text: item.marked_text,
          translation_fa: item.translation_fa,
          unit_codes: item.unit_codes,
          errors: marks.map((mark, k) => ({ ...mark, why_fa: item.errors[k].why_fa })) as Prisma.InputJsonValue,
          tokens: mapped.rows as unknown as Prisma.InputJsonValue,
          ...trace(batch),
        },
      });
      round.added++;
      round.accepted.push({ label: text, entity: { type: "errorfix_item", id: created.id }, record });
    }
    return round;
  },
};
