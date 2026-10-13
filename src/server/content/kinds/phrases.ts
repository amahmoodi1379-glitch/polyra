import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { phraseListItem } from "@/schemas/words";
import { db } from "@/server/db";
import type { LevelTargets } from "@/server/settings/app-catalog";
import { appSetting } from "@/server/settings/read";
import { freeCode } from "../codes";
import { lastIntroOrder, placeAfter } from "../intro-order";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { allowedWords } from "./allowed";
import { example, labelOf, languageValues, lines, params, trace } from "./shared";
import type { ContentKind } from "./types";

type PhrasesParams = { level: string; count: number };

const openStates = ["prompt_made", "pasted"] as const;
const same = (text: string) => fold(text).replace(/\s+/g, " ").trim();
/** A phrase is more than one word: a space, an apostrophe or a hyphen between letters. */
const severalWords = (lemma: string) => /\p{L}[\s'’-]+\p{L}/u.test(lemma.trim());

export type PhrasesNext =
  | { state: "ready"; level: string; count: number; goal: number }
  | { state: "needsWords"; level: string }
  | { state: "done" };

/**
 * The next level whose phrase list is short of its target (PRD §7.8 targets, §14.5 P-F). A level
 * with an open P-F batch is skipped; a level waits until some of its words have their meaning.
 */
export async function nextPhrases(language: string, wanted?: string): Promise<PhrasesNext> {
  const [levels, targets, have, open, ready] = await Promise.all([
    appSetting<string[]>(`levels.${language}`),
    appSetting<Record<string, LevelTargets>>(`targets.${language}`),
    db.word.groupBy({ by: ["level"], where: { language, pos: "phrase", status: { not: "retired" } }, _count: true }),
    db.importBatch.findMany({ where: { language, prompt_kind: "P_F", state: { in: [...openStates] } }, select: { params: true } }),
    db.word.groupBy({ by: ["level"], where: { language, meaning_fa: { not: null }, pos: { not: "phrase" }, status: { not: "retired" } }, _count: true }),
  ]);
  const count = new Map(have.map((row) => [row.level, row._count]));
  const busy = new Set(open.map((batch) => (batch.params as Partial<PhrasesParams> | null)?.level));
  const short = levels.filter((level) => !busy.has(level) && (count.get(level) ?? 0) < (targets[level]?.phrases ?? 0));
  const level = wanted && short.includes(wanted) ? wanted : short[0];
  if (!level) return { state: "done" };
  if (!ready.some((row) => row.level === level)) return { state: "needsWords", level };
  const goal = targets[level].phrases;
  return { state: "ready", level, count: goal - (count.get(level) ?? 0), goal };
}

/**
 * P-F (PRD §14.5): the common phrases of one level. Each becomes a draft word with pos = phrase and
 * its parts, placed after its last part in the teaching order (PRD §5.8); P-W then completes it like
 * any other word.
 */
export const phrases: ContentKind = {
  kind: "P_F",
  template: "P-F.md",
  rootKey: "phrases",

  async plan(language, options) {
    const next = await nextPhrases(language, options.level);
    if (next.state === "done") return { nothing: t("admin.create.nothing.phrases") };
    if (next.state === "needsWords") return { nothing: t("admin.create.kinds.phrases.needsWords", { level: next.level }) };
    const { level, count } = next;
    const existing = await db.word.findMany({
      where: { language, pos: "phrase", status: { not: "retired" } },
      orderBy: [{ level: "asc" }, { intro_order: "asc" }],
      select: { lemma: true },
    });
    return {
      params: { level, count } satisfies PhrasesParams,
      values: {
        ...languageValues(language),
        level,
        count: String(count),
        allowed: await allowedWords(language, { level }, { meanings: false }),
        existing: lines(existing.map((row) => row.lemma)),
        // The example's level follows the batch, so the chatbot does not copy another level.
        example: example("P-F", language).replaceAll('"level": "A2"', `"level": "${level}"`),
      },
      summary: [t("admin.create.summary.phrases", { count, level })],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const language = batch.language;
    const { level } = params<PhrasesParams>(batch);
    const words = await tx.word.findMany({
      where: { language, status: { not: "retired" } },
      select: { id: true, code: true, lemma: true, pos: true, level: true, intro_order: true },
    });
    const byCode = new Map(words.map((word) => [word.code, word]));
    const taken = new Set(words.map((word) => word.code));
    const known = new Set(words.filter((word) => word.pos === "phrase").map((word) => same(word.lemma)));
    const inAnswer = new Set<string>();
    let order = await lastIntroOrder(tx, language, level);
    const moves: { wordId: number; afterId: number }[] = [];

    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["lemma"], index);
      const parsed = phraseListItem.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        round.rejected.push({ label, record, problems: zodProblems(parsed.error) });
        continue;
      }
      const item = parsed.data;
      const key = same(item.lemma);
      const problems: Problem[] = [];
      if (inAnswer.has(key)) problems.push(problem("repeatedInAnswer", { code: item.lemma }));
      if (!severalWords(item.lemma)) problems.push(problem("notPhrase", { lemma: item.lemma }));
      if (item.level !== level) problems.push(problem("levelMismatch", { value: item.level, level }));
      const unknown = item.parts.filter((code) => !byCode.has(code));
      if (unknown.length > 0) problems.push(problem("partsUnknown", { codes: unknown.join("، ") }));
      if (problems.length > 0) {
        round.rejected.push({ label, record, problems });
        continue;
      }
      inAnswer.add(key);
      if (known.has(key)) {
        round.skipped++;
        continue;
      }
      known.add(key);

      const word = await tx.word.create({
        data: {
          language,
          code: freeCode(item.lemma, "phrase", taken),
          lemma: item.lemma,
          pos: "phrase",
          level,
          parts: item.parts,
          intro_order: ++order,
          ...trace(batch),
        },
      });
      // After its last part of the same level; a phrase made of lower-level words stays at the end.
      const parts = item.parts.map((code) => byCode.get(code)!).filter((part) => part.level === level);
      const last = parts.reduce<(typeof parts)[number] | null>((top, part) => ((part.intro_order ?? 0) > (top?.intro_order ?? -1) ? part : top), null);
      if (last) moves.push({ wordId: word.id, afterId: last.id });
      round.added++;
      round.accepted.push({ label: item.lemma, entity: { type: "word", id: word.id }, record });
    }
    await placeAfter(tx, language, level, moves);
    return round;
  },
};
