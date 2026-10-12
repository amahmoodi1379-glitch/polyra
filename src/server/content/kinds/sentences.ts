import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { checkTokens, fold, type TokenProblem } from "@/engine/tokens";
import { t } from "@/i18n";
import { sentenceRecord, type SentenceRecord, type SentenceTargetRecord } from "@/schemas/sentences";
import { db } from "@/server/db";
import { appSetting, engineNumber } from "@/server/settings/read";
import { levelRank } from "../languages";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound, type Flag } from "../report";
import { loadVocabulary, type LoadedVocabulary } from "../vocabulary";
import { batchSize, example, labelOf, languageValues, lines, params, trace } from "./shared";
import type { ContentKind, Tx } from "./types";

type SentencesParams = { level: string; word_ids: number[] };

/** Card words: standard words with a meaning that are not no_card (colloquial ones have no sentences, PRD §5.4). */
const cardWord = { meaning_fa: { not: null }, no_card: false, register: "standard", dup_of_id: null, status: { not: "retired" } } as const;
/** The first words of a language get sentences made only from themselves (PRD §14.9). */
const FIRST_WORDS = 30;
/** Above this many allowed words the meanings are left out so the prompt fits (PRD §14.9). */
const LIST_WITH_MEANINGS = 600;
const MAX_SENTENCE = 200;
const MAX_OPTION = 80;
const OUT_OF_LIST_SHARE = 0.1;

/** Same sentence = same text after tidying spaces, apostrophes and case (PRD §14.9). */
export function sentenceHash(text: string) {
  const clean = fold(text).replace(/\s+/g, " ").trim();
  return createHash("sha256").update(clean).digest("hex");
}

const blankPattern = /\{\{(.*?)\}\}/g;
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const tidy = (text: string) => text.normalize("NFC").replace(/[’ʼ]/g, "'").replace(/\s+/g, " ").trim();

function tokenProblem(item: TokenProblem): Problem {
  switch (item.type) {
    case "not_found":
      return problem("tokenNotFound", { surface: item.surface });
    case "uncovered":
      return problem("tokenUncovered", { piece: item.piece });
    case "name_not_capital":
      return problem("nameNotCapital", { surface: item.surface });
    case "number_without_digit":
      return problem("numberWithoutDigit", { surface: item.surface });
  }
}

/** Blank rules of one target (PRD §13.3 "هدف جمله"). */
export function checkTarget(target: SentenceTargetRecord, text: string, path: string): Problem[] {
  const problems: Problem[] = [];
  const blanks = [...target.marked_text.matchAll(blankPattern)].map((match) => match[1].trim());
  if (blanks.length !== target.blanks) {
    problems.push(problem("blanksCount", { field: `${path}.marked_text`, found: blanks.length, expected: target.blanks }));
    return problems;
  }
  if (tidy(target.marked_text.replace(blankPattern, "$1")) !== tidy(text)) {
    problems.push(problem("markedTextMismatch", { field: `${path}.marked_text` }));
  }
  // One blank: flat lists. Two blanks: a list per blank.
  const acceptedPerBlank = target.blanks === 1 ? [target.accepted] : target.accepted;
  const distractorsPerBlank = target.blanks === 1 ? [target.distractors] : target.distractors;
  blanks.forEach((blank, index) => {
    const accepted = acceptedPerBlank[index];
    const distractors = distractorsPerBlank[index];
    const suffix = target.blanks === 1 ? "" : `[${index}]`;
    if (!isStrings(accepted)) {
      problems.push(problem("wrongType", { field: `${path}.accepted${suffix}` }));
      return;
    }
    if (!isStrings(distractors)) {
      problems.push(problem("wrongType", { field: `${path}.distractors${suffix}` }));
      return;
    }
    const acceptedSet = new Set(accepted.map((value) => fold(value.trim())));
    if (!acceptedSet.has(fold(blank))) problems.push(problem("blankNotAccepted", { text: blank, field: `${path}.accepted${suffix}` }));
    if (distractors.length !== 3) problems.push(problem("distractorsCount", { field: `${path}.distractors${suffix}` }));
    const folded = distractors.map((value) => fold(value.trim()));
    if (new Set(folded).size !== folded.length) problems.push(problem("distractorsRepeat", { field: `${path}.distractors${suffix}` }));
    for (const [k, value] of folded.entries()) {
      if (acceptedSet.has(value)) problems.push(problem("distractorAccepted", { value: distractors[k] }));
    }
  });
  return problems;
}

/** Length warnings (PRD §13.3 "همه"). */
function lengthFlags(sentence: SentenceRecord, label: string): Flag[] {
  const flags: Flag[] = [];
  if (sentence.text.length > MAX_SENTENCE) flags.push({ label, problem: problem("tooLong", { field: "text", max: MAX_SENTENCE }) });
  for (const target of sentence.targets) {
    const options = [...target.accepted, ...target.distractors].flat();
    if (options.some((option) => option.length > MAX_OPTION)) {
      flags.push({ label, problem: problem("tooLong", { field: "distractors", max: MAX_OPTION }) });
      break;
    }
  }
  return flags;
}

async function resolveTarget(tx: Tx, language: string, target: SentenceTargetRecord, vocabulary: LoadedVocabulary) {
  if (target.type === "word") return vocabulary.byCode(target.target)?.id ?? null;
  const unit = await tx.grammarUnit.findFirst({ where: { language, unit_code: target.target }, select: { id: true } });
  return unit?.id ?? null;
}

/**
 * P-S (PRD §14.5): sentences for the next 10 card words that have fewer than 8 targets. Each
 * sentence's word mapping is checked (PRD §14.1) and stored as sentence_word rows; unknown codes
 * become candidates and implausible mappings suspects, for the admin to resolve (PRD §13.9).
 */
export const sentences: ContentKind = {
  kind: "P_S",
  template: "P-S.md",
  rootKey: "sentences",

  async plan(language, options) {
    const goal = await engineNumber("publish.word_goal_targets");
    const levels = await appSetting<string[]>(`levels.${language}`);
    const lengths = await appSetting<Record<string, string>>("prompt.sentence_length");
    const size = await batchSize("P-S", 10);

    const candidates = await db.word.findMany({
      where: { language, ...cardWord, ...(options.level ? { level: options.level } : {}) },
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
    const needy = candidates
      .filter((word) => (counts.get(word.id) ?? 0) < goal)
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9));
    const level = needy.find((word) => levels.includes(word.level))?.level;
    if (!level) return { nothing: t("admin.create.nothing.sentences") };
    const batch = needy.filter((word) => word.level === level).slice(0, size);
    const lastOrder = Math.max(...batch.map((word) => word.intro_order ?? 0));

    // The allowed list: no_card words, plus every word introduced before these targets (PRD §14.9).
    const all = await db.word.findMany({
      where: { language, status: { not: "retired" }, dup_of_id: null },
      orderBy: [{ intro_order: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      select: { id: true, code: true, pos: true, meaning_fa: true, level: true, intro_order: true, no_card: true, register: true },
    });
    const ordered = all
      .filter((word) => !word.no_card && word.register === "standard")
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9));
    const firstWords = new Set(ordered.slice(0, FIRST_WORDS).map((word) => word.id));
    const targetIds = new Set(batch.map((word) => word.id));
    const early = batch.every((word) => firstWords.has(word.id));
    const allowed = all.filter((word) => {
      if (targetIds.has(word.id)) return false;
      if (word.no_card) return true;
      if (word.register !== "standard") return false;
      if (early) return firstWords.has(word.id);
      const rank = levelRank(word.level) - levelRank(level);
      return rank < 0 || (rank === 0 && (word.intro_order ?? 1e9) < lastOrder);
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
      summary: [
        t("admin.create.summary.sentences", { count: batch.length, level, goal }),
        batch.map((word) => word.code).join("، "),
      ],
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

      const mapping = checkTokens(sentence.text, sentence.tokens, vocabulary);
      if (!mapping.ok) problems.push(...mapping.problems.map(tokenProblem));

      const targetIds: number[] = [];
      for (const [k, target] of sentence.targets.entries()) {
        problems.push(...checkTarget(target, sentence.text, `targets[${k}]`));
        const id = await resolveTarget(tx, language, target, vocabulary);
        if (id === null) problems.push(problem("targetUnknown", { code: target.target }));
        targetIds.push(id ?? 0);
      }
      if (problems.length > 0 || !mapping.ok) {
        round.rejected.push({ label, record, problems });
        continue;
      }
      round.warnings.push(...lengthFlags(sentence, label));

      const hash = sentenceHash(sentence.text);
      const existingId =
        seenInAnswer.get(hash) ??
        (await tx.sentence.findUnique({ where: { language_text_hash: { language, text_hash: hash } }, select: { id: true } }))?.id;

      let sentenceId: number;
      if (existingId) {
        // The same sentence again: keep it, only add targets it does not have yet (PRD §14.9).
        sentenceId = existingId;
        round.skipped++;
      } else {
        const wordRows = mapping.rows.filter((row) => row.kind === "word");
        const levels = wordRows.map((row) => (row.word_id ? vocabulary.byId(row.word_id)?.level : null)).filter(Boolean) as string[];
        const outside = wordRows.filter((row) => {
          const word = row.word_id ? vocabulary.byId(row.word_id) : undefined;
          return !word || levelRank(word.level) > levelRank(level);
        }).length;
        if (wordRows.length > 0 && outside / wordRows.length >= OUT_OF_LIST_SHARE) {
          round.warnings.push({ label, problem: problem("outOfList", { share: Math.round((100 * outside) / wordRows.length) }) });
        }
        const created = await tx.sentence.create({
          data: {
            language,
            text: sentence.text,
            tts_text: sentence.tts_text,
            translation_fa: sentence.translation_fa,
            text_hash: hash,
            level: levels.reduce<string | null>((top, value) => (top && levelRank(top) >= levelRank(value) ? top : value), null),
            ...trace(batch),
            words: {
              create: mapping.rows.map((row) => ({
                position: row.position,
                kind: row.kind,
                word_id: row.word_id,
                surface: row.surface,
                spans: row.spans,
                meaning_fa_ctx: row.meaning_fa_ctx,
                suspect: row.suspect,
                code_given: row.code_given,
                candidate_reason: row.candidate_reason,
              })),
            },
          },
        });
        sentenceId = created.id;
        round.added++;
        round.candidates += mapping.rows.filter((row) => row.candidate_reason).length;
        round.suspects += mapping.rows.filter((row) => row.suspect).length;
      }
      seenInAnswer.set(hash, sentenceId);

      const present = await tx.sentenceTarget.findMany({
        where: { sentence_id: sentenceId },
        select: { target_type: true, target_id: true, marked_text: true },
      });
      const has = new Set(present.map((row) => `${row.target_type}|${row.target_id}|${tidy(row.marked_text)}`));
      for (const [k, target] of sentence.targets.entries()) {
        const key = `${target.type}|${targetIds[k]}|${tidy(target.marked_text)}`;
        if (has.has(key)) continue;
        has.add(key);
        await tx.sentenceTarget.create({
          data: {
            language,
            sentence_id: sentenceId,
            target_type: target.type,
            target_id: targetIds[k],
            marked_text: target.marked_text,
            blanks: target.blanks,
            accepted: target.accepted as Prisma.InputJsonValue,
            distractors: target.distractors as Prisma.InputJsonValue,
            hint: target.hint,
            accepted_full: (target.accepted_full ?? undefined) as Prisma.InputJsonValue | undefined,
            ...trace(batch),
          },
        });
      }
      round.accepted.push({ label: sentence.text, entity: { type: "sentence", id: sentenceId }, record });
    }
    return round;
  },
};
