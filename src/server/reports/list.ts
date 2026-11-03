import type { LibrarySlug } from "@/server/content/library/slugs";
import { db } from "@/server/db";
import { acceptPlace } from "./admin";
import { reportSlug } from "./slugs";

/**
 * The «گزارش‌ها» queue (PRD §13.10): open reports first by priority then age, or the last ones handled;
 * each with its item's title, the sentence, the learner's answer and how it was recorded, and what the
 * teacher can do with it.
 */

export const REPORTS_SHOWN = 100;
export type ReportView = "open" | "done";

export type ReportRow = {
  id: number;
  createdAt: Date;
  reason: "my_answer_ok" | "answer_wrong" | "audio" | "translation" | "other";
  note: string | null;
  raw: string | null;
  priority: "normal" | "high";
  status: "open" | "fixed" | "rejected";
  language: string | null;
  code: string | null;
  /** How the answer was recorded: only wrong and «نمی‌دانم» can be put right for the learner. */
  result: string | null;
  /** The sentence's target the exercise asked about. */
  targetId: number | null;
  item: { type: string; slug: LibrarySlug | null; id: number; title: string | null; href: string | null; suspended: boolean | null };
  sentence: { id: number; text: string; translation: string | null; suspended: boolean } | null;
  /** Open reports on the same item, this one included. */
  sameItem: number;
  canAccept: boolean;
  userId: number | null;
  phone: string | null;
};

export async function itemTitles(keys: { type: string; id: number }[]) {
  const ids = (type: string) => [...new Set(keys.filter((key) => key.type === type).map((key) => key.id))];
  const [words, units, tables, transforms, translations, texts, dialogues, errorfix, writing, phonics, sentences] = await Promise.all([
    db.word.findMany({ where: { id: { in: ids("word") } }, select: { id: true, lemma: true, suspended: true } }),
    db.grammarUnit.findMany({ where: { id: { in: ids("grammar_unit") } }, select: { id: true, title_fa: true, suspended: true } }),
    db.conjugationTable.findMany({ where: { id: { in: [...ids("conjugation"), ...ids("conjugation_table")] } }, select: { id: true, tense: true, word_id: true, suspended: true } }),
    db.transformItem.findMany({ where: { id: { in: ids("transform_item") } }, select: { id: true, source_sentence: true, suspended: true } }),
    db.translateItem.findMany({ where: { id: { in: ids("translate_item") } }, select: { id: true, prompt_fa: true, suspended: true } }),
    db.text.findMany({ where: { id: { in: ids("text") } }, select: { id: true, title: true, suspended: true } }),
    db.dialogue.findMany({ where: { id: { in: ids("dialogue") } }, select: { id: true, title_fa: true, suspended: true } }),
    db.errorfixItem.findMany({ where: { id: { in: ids("errorfix_item") } }, select: { id: true, marked_text: true, suspended: true } }),
    db.writingTask.findMany({ where: { id: { in: ids("writing_task") } }, select: { id: true, prompt_fa: true, suspended: true } }),
    db.phonicsLesson.findMany({ where: { id: { in: ids("phonics_lesson") } }, select: { id: true, sound_label: true, suspended: true } }),
    db.sentence.findMany({ where: { id: { in: ids("sentence") } }, select: { id: true, text: true, suspended: true } }),
  ]);
  const verbs = new Map((await db.word.findMany({ where: { id: { in: tables.map((row) => row.word_id) } }, select: { id: true, lemma: true } })).map((row) => [row.id, row.lemma]));
  const map = new Map<string, { title: string; suspended: boolean }>();
  for (const row of words) map.set(`word:${row.id}`, { title: row.lemma, suspended: row.suspended });
  for (const row of units) map.set(`grammar_unit:${row.id}`, { title: row.title_fa, suspended: row.suspended });
  for (const row of tables) {
    const value = { title: `${verbs.get(row.word_id) ?? ""} · ${row.tense}`, suspended: row.suspended };
    map.set(`conjugation:${row.id}`, value);
    map.set(`conjugation_table:${row.id}`, value);
  }
  for (const row of transforms) map.set(`transform_item:${row.id}`, { title: row.source_sentence, suspended: row.suspended });
  for (const row of translations) map.set(`translate_item:${row.id}`, { title: row.prompt_fa, suspended: row.suspended });
  for (const row of texts) map.set(`text:${row.id}`, { title: row.title, suspended: row.suspended });
  for (const row of dialogues) map.set(`dialogue:${row.id}`, { title: row.title_fa, suspended: row.suspended });
  for (const row of errorfix) map.set(`errorfix_item:${row.id}`, { title: row.marked_text.replace(/[{}]/g, ""), suspended: row.suspended });
  for (const row of writing) map.set(`writing_task:${row.id}`, { title: row.prompt_fa, suspended: row.suspended });
  for (const row of phonics) map.set(`phonics_lesson:${row.id}`, { title: row.sound_label, suspended: row.suspended });
  for (const row of sentences) map.set(`sentence:${row.id}`, { title: row.text, suspended: row.suspended });
  return map;
}

type ReportWithUser = Awaited<ReturnType<typeof loadReports>>[number];

const loadReports = (where: NonNullable<Parameters<typeof db.contentReport.findMany>[0]>["where"], orderBy: NonNullable<Parameters<typeof db.contentReport.findMany>[0]>["orderBy"], take: number) =>
  db.contentReport.findMany({ where, orderBy, take, include: { user: { select: { phone: true } } } });

async function logsOf(reports: ReportWithUser[]) {
  const ids = reports.map((row) => row.review_log_id).filter((id): id is string => !!id);
  return new Map((await db.reviewLog.findMany({ where: { id: { in: ids } } })).map((row) => [row.id, row]));
}

/** Each report with its item's title and link, the sentence, how the answer was recorded and what can be done with it. */
async function describe(reports: ReportWithUser[], logs: Awaited<ReturnType<typeof logsOf>>): Promise<ReportRow[]> {
  const [named, sentences, counts] = await Promise.all([
    itemTitles(reports.map((report) => ({ type: report.item_type, id: report.item_id }))),
    db.sentence.findMany({ where: { id: { in: reports.map((report) => report.sentence_id).filter((id): id is number => id !== null) } }, select: { id: true, text: true, translation_fa: true, suspended: true } }),
    db.contentReport.groupBy({ by: ["item_type", "item_id"], where: { status: "open" }, _count: { _all: true } }),
  ]);
  const sentenceOf = new Map(sentences.map((row) => [row.id, row]));
  const countOf = new Map(counts.map((row) => [`${row.item_type}:${row.item_id}`, row._count._all]));
  return reports.map((report) => {
    const log = report.review_log_id ? (logs.get(report.review_log_id) ?? null) : null;
    const key = `${report.item_type}:${report.item_id}`;
    const slug = reportSlug[report.item_type];
    const sentence = report.sentence_id !== null ? sentenceOf.get(report.sentence_id) : undefined;
    return {
      id: report.id,
      createdAt: report.created_at,
      reason: report.reason,
      note: report.note,
      raw: report.raw_answer,
      priority: report.priority,
      status: report.status,
      language: log?.language ?? null,
      code: report.exercise_code,
      result: log?.result ?? null,
      targetId: log?.sentence_target_id ?? null,
      item: {
        type: report.item_type,
        slug: slug ?? null,
        id: report.item_id,
        title: named.get(key)?.title ?? null,
        href: slug && named.has(key) ? `/admin/content/${slug}/${report.item_id}` : null,
        suspended: named.get(key)?.suspended ?? null,
      },
      sentence: sentence ? { id: sentence.id, text: sentence.text, translation: sentence.translation_fa, suspended: sentence.suspended } : null,
      sameItem: countOf.get(key) ?? 0,
      canAccept: report.status === "open" && acceptPlace(report, log) !== null,
      userId: report.user_id,
      phone: report.user?.phone ?? null,
    };
  });
}

/** The ids of the reports in one language (the language is the answer's), in the queue's order. */
async function reportIds(view: ReportView, language: string): Promise<number[]> {
  const rows =
    view === "open"
      ? await db.$queryRaw<{ id: number }[]>`SELECT r.id FROM "content_report" r JOIN "review_log" l ON l.id = r.review_log_id
          WHERE r.status = 'open' AND l.language = ${language} ORDER BY r.priority DESC, r.created_at ASC, r.id ASC LIMIT ${REPORTS_SHOWN}`
      : await db.$queryRaw<{ id: number }[]>`SELECT r.id FROM "content_report" r JOIN "review_log" l ON l.id = r.review_log_id
          WHERE r.status <> 'open' AND l.language = ${language} ORDER BY r.id DESC LIMIT ${REPORTS_SHOWN}`;
  return rows.map((row) => row.id);
}

/** Open reports, and how many of them are urgent; in one language (the answer's) or all. */
export async function openReportCount(language: string | null): Promise<{ open: number; high: number }> {
  const rows = language
    ? await db.$queryRaw<{ open: bigint; high: bigint }[]>`SELECT count(*) AS open, count(*) FILTER (WHERE r.priority = 'high') AS high FROM "content_report" r
        JOIN "review_log" l ON l.id = r.review_log_id WHERE r.status = 'open' AND l.language = ${language}`
    : await db.$queryRaw<{ open: bigint; high: bigint }[]>`SELECT count(*) AS open, count(*) FILTER (WHERE priority = 'high') AS high FROM "content_report" WHERE status = 'open'`;
  return { open: Number(rows[0]?.open ?? 0), high: Number(rows[0]?.high ?? 0) };
}

export async function reportQueue(view: ReportView, language: string | null): Promise<{ rows: ReportRow[]; open: number; high: number }> {
  let reports: ReportWithUser[];
  if (language) {
    const ids = await reportIds(view, language);
    const found = new Map((await loadReports({ id: { in: ids } }, undefined, ids.length)).map((row) => [row.id, row]));
    reports = ids.map((id) => found.get(id)).filter((row): row is ReportWithUser => !!row);
  } else {
    reports = await loadReports(
      view === "open" ? { status: "open" } : { status: { not: "open" } },
      view === "open" ? [{ priority: "desc" }, { created_at: "asc" }, { id: "asc" }] : [{ id: "desc" }],
      REPORTS_SHOWN,
    );
  }
  const [logs, counts] = await Promise.all([logsOf(reports), openReportCount(language)]);
  return { ...counts, rows: await describe(reports, logs) };
}

/** One report, for its own page. */
export async function reportRow(id: number): Promise<ReportRow | null> {
  const reports = await loadReports({ id }, undefined, 1);
  if (reports.length === 0) return null;
  return (await describe(reports, await logsOf(reports)))[0];
}
