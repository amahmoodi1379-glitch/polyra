import type { ContentStatus, Prisma } from "@/generated/prisma/client";
import { t } from "@/i18n";
import { pronounKeys } from "@/schemas/conjugation";
import { db } from "@/server/db";
import { appSetting, engineNumber } from "@/server/settings/read";
import { correctedText } from "../kinds/errorfix";
import { levelRank, type LanguageCode } from "../languages";
import type { ContentStatusValue, LibrarySlug } from "./slugs";

/**
 * The lists of «همه محتوا» (PRD §13.2): every content type with filters for level, status and
 * «ناقص». «ناقص» is what still blocks publishing apart from audio and the reviewer's approval
 * (PRD §5.10, §6.7, §7.7): a word without meaning or short of sentences, a unit without its lesson,
 * open candidates in a sentence, and so on. Each row says what is missing in plain Persian.
 */

export const PAGE_SIZE = 40;

export type StatusFilter = ContentStatusValue | "suspended" | null;
export type LibraryFilters = { level: string | null; status: StatusFilter; incomplete: boolean; q: string; page: number };

/** "target" text is French or German (set in the serif, left to right); "fa" is Persian. */
export type Voice = "target" | "fa";

export type LibraryRow = {
  id: number;
  title: string;
  titleVoice: Voice;
  subtitle: string | null;
  subtitleVoice: Voice;
  /** Small facts such as the part of speech or the unit, in Persian. */
  meta: string | null;
  level: string | null;
  status: ContentStatus;
  suspended: boolean;
  missing: string[];
};

export type LibraryPage = { rows: LibraryRow[]; total: number; page: number; pages: number };

type Where = { language: string; status?: ContentStatus | { not: ContentStatus }; suspended?: boolean };

function statusWhere(language: string, status: StatusFilter): Where {
  if (status === "suspended") return { language, suspended: true, status: { not: "retired" } };
  if (status) return { language, status };
  return { language, status: { not: "retired" } };
}

const like = (q: string) => ({ contains: q, mode: "insensitive" as const });
const openRow = { OR: [{ candidate_reason: { not: null } }, { suspect: true }] } satisfies Prisma.SentenceWordWhereInput;
const byLevel = <T extends { level: string | null }>(a: T, b: T) => levelRank(a.level) - levelRank(b.level);

function page(rows: LibraryRow[], filters: LibraryFilters): LibraryPage {
  const kept = filters.incomplete ? rows.filter((row) => row.missing.length > 0) : rows;
  return slice(kept, kept.length, filters.page);
}

function slice(rows: LibraryRow[], total: number, wanted: number, already = false): LibraryPage {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, wanted), pages);
  return { rows: already ? rows : rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), total, page: current, pages };
}

/** Candidates and suspects still open, as missing-lines. */
function openLines(candidates: number, suspects: number) {
  const lines: string[] = [];
  if (candidates) lines.push(t("admin.library.missing.candidates", { count: candidates }));
  if (suspects) lines.push(t("admin.library.missing.suspects", { count: suspects }));
  return lines;
}

/** Open candidate and suspect rows of each sentence. */
async function openBySentence(ids: number[]) {
  if (ids.length === 0) return new Map<number, { candidates: number; suspects: number }>();
  const rows = await db.sentenceWord.findMany({
    where: { sentence_id: { in: ids }, ...openRow },
    select: { sentence_id: true, candidate_reason: true, suspect: true },
  });
  const open = new Map<number, { candidates: number; suspects: number }>();
  for (const row of rows) {
    const entry = open.get(row.sentence_id) ?? { candidates: 0, suspects: 0 };
    if (row.candidate_reason) entry.candidates++;
    else entry.suspects++;
    open.set(row.sentence_id, entry);
  }
  return open;
}

function sumOpen(ids: number[], open: Map<number, { candidates: number; suspects: number }>) {
  let candidates = 0;
  let suspects = 0;
  for (const id of ids) {
    candidates += open.get(id)?.candidates ?? 0;
    suspects += open.get(id)?.suspects ?? 0;
  }
  return openLines(candidates, suspects);
}

/** Open rows inside a stored token list (a short translation, a find-the-mistake text). */
function openInTokens(tokens: unknown) {
  const rows = Array.isArray(tokens) ? (tokens as { candidate_reason?: string | null; suspect?: boolean }[]) : [];
  return openLines(rows.filter((row) => row.candidate_reason).length, rows.filter((row) => !row.candidate_reason && row.suspect).length);
}

async function words(language: string, filters: LibraryFilters) {
  const goal = await engineNumber("publish.word_goal_targets");
  const q = filters.q;
  const rows = await db.word.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { level: filters.level } : {}),
      ...(q ? { OR: [{ lemma: like(q) }, { code: like(q) }, { meaning_fa: like(q) }] } : {}),
    },
    orderBy: [{ intro_order: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: {
      id: true,
      lemma: true,
      pos: true,
      gender: true,
      number: true,
      plural: true,
      meaning_fa: true,
      level: true,
      status: true,
      suspended: true,
      no_card: true,
      dup_of_id: true,
    },
  });
  const counts = await db.sentenceTarget.groupBy({
    by: ["target_id"],
    where: { language, target_type: "word", status: { not: "retired" }, target_id: { in: rows.map((row) => row.id) } },
    _count: true,
  });
  const targets = new Map(counts.map((row) => [row.target_id, row._count]));
  return rows.sort(byLevel).map((word): LibraryRow => {
    const missing: string[] = [];
    if (word.dup_of_id) missing.push(t("admin.library.missing.duplicate"));
    if (!word.meaning_fa) missing.push(t("admin.library.missing.noMeaning"));
    else {
      if (word.pos === "noun" && !word.gender) missing.push(t("admin.library.missing.noGender"));
      if (language === "de" && word.pos === "noun" && word.number === "sg" && !word.plural) missing.push(t("admin.library.missing.noPlural"));
      const count = targets.get(word.id) ?? 0;
      if (!word.no_card && count < goal) missing.push(t("admin.library.missing.targets", { count, goal }));
    }
    return {
      id: word.id,
      title: word.lemma,
      titleVoice: "target",
      subtitle: word.meaning_fa,
      subtitleVoice: "fa",
      meta: [t(`content.pos.${word.pos}`), word.gender].filter(Boolean).join(" · "),
      level: word.level,
      status: word.status,
      suspended: word.suspended,
      missing,
    };
  });
}

async function sentences(language: string, filters: LibraryFilters): Promise<LibraryPage> {
  const q = filters.q;
  const where: Prisma.SentenceWhereInput = {
    ...statusWhere(language, filters.status),
    ...(filters.level ? { level: filters.level } : {}),
    ...(q ? { OR: [{ text: like(q) }, { translation_fa: like(q) }] } : {}),
    ...(filters.incomplete ? { words: { some: openRow } } : {}),
  };
  const total = await db.sentence.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, filters.page), pages);
  const rows = await db.sentence.findMany({
    where,
    orderBy: { id: "asc" },
    skip: (current - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: { id: true, text: true, translation_fa: true, level: true, status: true, suspended: true },
  });
  const open = await openBySentence(rows.map((row) => row.id));
  return slice(
    rows.map((row) => ({
      id: row.id,
      title: row.text,
      titleVoice: "target",
      subtitle: row.translation_fa,
      subtitleVoice: "fa",
      meta: null,
      level: row.level,
      status: row.status,
      suspended: row.suspended,
      missing: sumOpen([row.id], open),
    })),
    total,
    current,
    true,
  );
}

async function units(language: string, filters: LibraryFilters) {
  const min = await engineNumber("publish.unit_min_targets");
  const q = filters.q;
  const rows = await db.grammarUnit.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { level: filters.level } : {}),
      ...(q ? { OR: [{ title_fa: like(q) }, { unit_code: like(q) }] } : {}),
    },
    orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: {
      id: true,
      unit_code: true,
      title_fa: true,
      level: true,
      status: true,
      suspended: true,
      lesson_fa: true,
      rule_line_fa: true,
      example_sentence_ids: true,
    },
  });
  const counts = await db.sentenceTarget.groupBy({
    by: ["target_id"],
    where: { language, target_type: "grammar", status: { not: "retired" }, target_id: { in: rows.map((row) => row.id) } },
    _count: true,
  });
  const targets = new Map(counts.map((row) => [row.target_id, row._count]));
  return rows.sort(byLevel).map((unit): LibraryRow => {
    const missing: string[] = [];
    if (!unit.lesson_fa) missing.push(t("admin.library.missing.noLesson"));
    else {
      if (!unit.rule_line_fa) missing.push(t("admin.library.missing.noRule"));
      if (unit.example_sentence_ids.length < 3) missing.push(t("admin.library.missing.examples", { count: unit.example_sentence_ids.length }));
      const count = targets.get(unit.id) ?? 0;
      if (count < min) missing.push(t("admin.library.missing.targets", { count, goal: min }));
    }
    return {
      id: unit.id,
      title: unit.title_fa,
      titleVoice: "fa",
      subtitle: unit.unit_code,
      subtitleVoice: "target",
      meta: null,
      level: unit.level,
      status: unit.status,
      suspended: unit.suspended,
      missing,
    };
  });
}

async function tables(language: string, filters: LibraryFilters) {
  const q = filters.q;
  const rows = await db.conjugationTable.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { word: { level: filters.level } } : {}),
      ...(q ? { OR: [{ word: { lemma: like(q) } }, { tense: like(q) }] } : {}),
    },
    orderBy: { id: "asc" },
    select: { id: true, tense: true, forms: true, status: true, suspended: true, word: { select: { lemma: true, level: true } } },
  });
  const keys = pronounKeys[language as LanguageCode] ?? [];
  return rows
    .map((row) => ({ ...row, level: row.word.level }))
    .sort((a, b) => byLevel(a, b) || a.word.lemma.localeCompare(b.word.lemma) || a.tense.localeCompare(b.tense))
    .map((row): LibraryRow => {
      const forms = (row.forms ?? {}) as Record<string, string>;
      const empty = keys.filter((key) => !forms[key]?.trim()).length;
      return {
        id: row.id,
        title: `${row.word.lemma} · ${row.tense}`,
        titleVoice: "target",
        subtitle: keys.map((key) => forms[key] ?? "").filter(Boolean).join(" · "),
        subtitleVoice: "target",
        meta: null,
        level: row.level,
        status: row.status,
        suspended: row.suspended,
        missing: empty ? [t("admin.library.missing.forms", { count: empty })] : [],
      };
    });
}

async function transforms(language: string, filters: LibraryFilters) {
  const q = filters.q;
  const rows = await db.transformItem.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { grammar_unit: { level: filters.level } } : {}),
      ...(q ? { OR: [{ source_sentence: like(q) }, { instruction_fa: like(q) }] } : {}),
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      source_sentence: true,
      instruction_fa: true,
      status: true,
      suspended: true,
      grammar_unit: { select: { title_fa: true, level: true, order_no: true } },
    },
  });
  return rows
    .map((row) => ({ ...row, level: row.grammar_unit.level }))
    .sort((a, b) => byLevel(a, b) || (a.grammar_unit.order_no ?? 1e9) - (b.grammar_unit.order_no ?? 1e9))
    .map(
      (row): LibraryRow => ({
        id: row.id,
        title: row.source_sentence,
        titleVoice: "target",
        subtitle: row.instruction_fa,
        subtitleVoice: "fa",
        meta: row.grammar_unit.title_fa,
        level: row.level,
        status: row.status,
        suspended: row.suspended,
        missing: [],
      }),
    );
}

async function translations(language: string, filters: LibraryFilters) {
  const q = filters.q;
  const rows = await db.translateItem.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { grammar_unit: { level: filters.level } } : {}),
      ...(q ? { OR: [{ prompt_fa: like(q) }, { accepted_outputs: { has: q } }] } : {}),
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      prompt_fa: true,
      accepted_outputs: true,
      tokens: true,
      status: true,
      suspended: true,
      grammar_unit: { select: { title_fa: true, level: true, order_no: true } },
    },
  });
  return rows
    .map((row) => ({ ...row, level: row.grammar_unit.level }))
    .sort((a, b) => byLevel(a, b) || (a.grammar_unit.order_no ?? 1e9) - (b.grammar_unit.order_no ?? 1e9))
    .map(
      (row): LibraryRow => ({
        id: row.id,
        title: row.prompt_fa,
        titleVoice: "fa",
        subtitle: row.accepted_outputs[0] ?? null,
        subtitleVoice: "target",
        meta: row.grammar_unit.title_fa,
        level: row.level,
        status: row.status,
        suspended: row.suspended,
        missing: openInTokens(row.tokens),
      }),
    );
}

async function texts(language: string, filters: LibraryFilters) {
  const q = filters.q;
  const rows = await db.text.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { level: filters.level } : {}),
      ...(q ? { OR: [{ title: like(q) }, { code: like(q) }] } : {}),
    },
    orderBy: [{ order_override: { sort: "asc", nulls: "last" } }, { code: "asc" }],
    select: { id: true, code: true, title: true, kind: true, band: true, level: true, status: true, suspended: true, sentence_ids: true },
  });
  const kinds = await appSetting<Record<string, { kind: string; name_fa: string }[]>>("prompt.text_kinds");
  const names = new Map(Object.values(kinds).flat().map((kind) => [kind.kind, kind.name_fa]));
  const open = await openBySentence(rows.flatMap((row) => row.sentence_ids));
  return rows.sort(byLevel).map(
    (row): LibraryRow => ({
      id: row.id,
      title: row.title,
      titleVoice: "target",
      subtitle: row.code,
      subtitleVoice: "target",
      meta: [names.get(row.kind) ?? row.kind, t("admin.library.band", { band: row.band })].join(" · "),
      level: row.level,
      status: row.status,
      suspended: row.suspended,
      missing: sumOpen(row.sentence_ids, open),
    }),
  );
}

type Turn = { sentence_id?: number; choices?: { sentence_id?: number }[] };
export const turnSentenceIds = (turns: unknown) =>
  ((turns ?? []) as Turn[]).flatMap((turn) => [turn.sentence_id, ...(turn.choices ?? []).map((choice) => choice.sentence_id)]).filter(
    (id): id is number => typeof id === "number",
  );

async function dialogues(language: string, filters: LibraryFilters) {
  const q = filters.q;
  const rows = await db.dialogue.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { level: filters.level } : {}),
      ...(q ? { OR: [{ title_fa: like(q) }, { situation_fa: like(q) }, { code: like(q) }] } : {}),
    },
    orderBy: { code: "asc" },
    select: { id: true, code: true, title_fa: true, situation_fa: true, level: true, status: true, suspended: true, turns: true },
  });
  const open = await openBySentence(rows.flatMap((row) => turnSentenceIds(row.turns)));
  return rows.sort(byLevel).map(
    (row): LibraryRow => ({
      id: row.id,
      title: row.title_fa,
      titleVoice: "fa",
      subtitle: row.situation_fa,
      subtitleVoice: "fa",
      meta: t("admin.library.turns", { count: ((row.turns ?? []) as Turn[]).length }),
      level: row.level,
      status: row.status,
      suspended: row.suspended,
      missing: sumOpen(turnSentenceIds(row.turns), open),
    }),
  );
}

async function errorfix(language: string, filters: LibraryFilters) {
  const q = filters.q;
  const rows = await db.errorfixItem.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { level: filters.level } : {}),
      ...(q ? { OR: [{ marked_text: like(q) }, { translation_fa: like(q) }] } : {}),
    },
    orderBy: { id: "asc" },
    select: { id: true, marked_text: true, translation_fa: true, errors: true, level: true, status: true, suspended: true, tokens: true },
  });
  return rows.sort(byLevel).map(
    (row): LibraryRow => ({
      id: row.id,
      title: correctedText(row.marked_text),
      titleVoice: "target",
      subtitle: row.translation_fa,
      subtitleVoice: "fa",
      meta: t("admin.library.mistakes", { count: Array.isArray(row.errors) ? row.errors.length : 0 }),
      level: row.level,
      status: row.status,
      suspended: row.suspended,
      missing: openInTokens(row.tokens),
    }),
  );
}

async function writing(language: string, filters: LibraryFilters) {
  const q = filters.q;
  const rows = await db.writingTask.findMany({
    where: {
      ...statusWhere(language, filters.status),
      ...(filters.level ? { level: filters.level } : {}),
      ...(q ? { OR: [{ prompt_fa: like(q) }, { model_answer: like(q) }] } : {}),
    },
    orderBy: { id: "asc" },
    select: { id: true, prompt_fa: true, min_words: true, max_words: true, level: true, status: true, suspended: true },
  });
  return rows.sort(byLevel).map(
    (row): LibraryRow => ({
      id: row.id,
      title: row.prompt_fa,
      titleVoice: "fa",
      subtitle: null,
      subtitleVoice: "fa",
      meta: t("admin.library.wordRange", { min: row.min_words, max: row.max_words }),
      level: row.level,
      status: row.status,
      suspended: row.suspended,
      missing: [],
    }),
  );
}

async function phonics(language: string, filters: LibraryFilters) {
  const q = filters.q;
  const rows = await db.phonicsLesson.findMany({
    where: { ...statusWhere(language, filters.status), ...(q ? { OR: [{ sound_label: like(q) }, { tip_fa: like(q) }] } : {}) },
    orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true, sound_label: true, kind: true, graphemes: true, status: true, suspended: true },
  });
  return rows.map(
    (row): LibraryRow => ({
      id: row.id,
      title: row.sound_label,
      titleVoice: "fa",
      subtitle: row.graphemes.join(" · ") || null,
      subtitleVoice: "target",
      meta: t(`admin.library.phonicsKind.${row.kind}`),
      level: null,
      status: row.status,
      suspended: row.suspended,
      missing: [],
    }),
  );
}

/** One page of one content type, filtered (PRD §13.2 «محتوا»). */
export async function listItems(slug: LibrarySlug, language: string, filters: LibraryFilters): Promise<LibraryPage> {
  switch (slug) {
    case "sentences":
      return sentences(language, filters);
    case "words":
      return page(await words(language, filters), filters);
    case "units":
      return page(await units(language, filters), filters);
    case "tables":
      return page(await tables(language, filters), filters);
    case "transforms":
      return page(await transforms(language, filters), filters);
    case "translations":
      return page(await translations(language, filters), filters);
    case "texts":
      return page(await texts(language, filters), filters);
    case "dialogues":
      return page(await dialogues(language, filters), filters);
    case "errorfix":
      return page(await errorfix(language, filters), filters);
    case "writing":
      return page(await writing(language, filters), filters);
    case "phonics":
      return page(await phonics(language, filters), filters);
  }
}

/** How many items each type has in one language, retired ones aside. */
export async function typeCounts(language: string): Promise<Record<LibrarySlug, number>> {
  const where = { language, status: { not: "retired" as const } };
  const [words, sentences, units, tables, transforms, translations, texts, dialogues, errorfix, writing, phonics] = await Promise.all([
    db.word.count({ where }),
    db.sentence.count({ where }),
    db.grammarUnit.count({ where }),
    db.conjugationTable.count({ where }),
    db.transformItem.count({ where }),
    db.translateItem.count({ where }),
    db.text.count({ where }),
    db.dialogue.count({ where }),
    db.errorfixItem.count({ where }),
    db.writingTask.count({ where }),
    db.phonicsLesson.count({ where }),
  ]);
  return { words, sentences, units, tables, transforms, translations, texts, dialogues, errorfix, writing, phonics };
}
