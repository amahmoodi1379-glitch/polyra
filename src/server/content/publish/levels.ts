import { t, type MessageKey } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { db } from "@/server/db";
import type { LevelTargets } from "@/server/settings/app-catalog";
import { appSetting } from "@/server/settings/read";
import type { Tx } from "../kinds/types";
import { levelRank } from "../languages";
import { turnSentenceIds } from "../library/list";
import { logChange } from "../library/log";
import type { LibrarySlug } from "../library/slugs";
import { checkItems, type CheckedItem } from "./checks";

/**
 * Releasing a level and a language (PRD §13.5). A level opens the published content of that level to
 * ordinary learners; its checklist has blocking lines and warnings the teacher may confirm past.
 * Levels open from the bottom up and close from the top down. A language shows in the app only
 * once its first level is open.
 */

export type CheckLine = { key: string; kind: "block" | "warn"; ok: boolean; text: string; details: string[] };
export type LevelState = {
  level: string;
  released: { at: Date; by: string | null } | null;
  /** The checklist, read for a level that is open or next to open; empty for the ones above. */
  lines: CheckLine[];
  /** Released levels must be a run from the first level: these say which neighbour stops a change. */
  lowerOpen: boolean;
  higherOpen: boolean;
};
export type LanguageState = { live: boolean; firstLevel: string; firstOpen: boolean; levels: LevelState[] };

const line = (key: string, kind: CheckLine["kind"], ok: boolean, details: string[] = [], vars?: Record<string, string | number>) => ({
  key,
  kind,
  ok,
  text: t(`admin.publish.check.${key}.${ok ? "ok" : "bad"}` as MessageKey, vars),
  details,
});

/** The item type names a content report may carry, by library type. */
const reportTypes: Record<string, LibrarySlug> = {
  word: "words",
  sentence: "sentences",
  grammar_unit: "units",
  conjugation: "tables",
  conjugation_table: "tables",
  transform_item: "transforms",
  translate_item: "translations",
  text: "texts",
  dialogue: "dialogues",
  errorfix_item: "errorfix",
  writing_task: "writing",
  phonics_lesson: "phonics",
};

/** The sentences learners meet in a level: its own, and those of its texts, dialogues, units and targets. */
async function levelSentences(tx: Tx, language: string, level: string, items: CheckedItem[]) {
  const ids = (slug: LibrarySlug) => items.filter((item) => item.slug === slug).map((item) => item.id);
  const [texts, dialogues, units, targets] = await Promise.all([
    tx.text.findMany({ where: { id: { in: ids("texts") } }, select: { sentence_ids: true } }),
    tx.dialogue.findMany({ where: { id: { in: ids("dialogues") } }, select: { turns: true } }),
    tx.grammarUnit.findMany({ where: { id: { in: ids("units") } }, select: { example_sentence_ids: true } }),
    tx.sentenceTarget.findMany({
      where: {
        language,
        status: "published",
        OR: [
          { target_type: "word", target_id: { in: ids("words") } },
          { target_type: "grammar", target_id: { in: ids("units") } },
        ],
      },
      select: { sentence_id: true },
    }),
  ]);
  const all = new Set([
    ...ids("sentences"),
    ...texts.flatMap((row) => row.sentence_ids),
    ...dialogues.flatMap((row) => turnSentenceIds(row.turns)),
    ...units.flatMap((row) => row.example_sentence_ids),
    ...targets.map((row) => row.sentence_id),
  ]);
  return (await tx.sentence.findMany({ where: { id: { in: [...all] }, status: "published" }, select: { id: true } })).map((row) => row.id);
}

/** The recording that plays (human first, then machine) and whether someone has listened to it (PRD §13.4). */
async function listening(tx: Tx, rows: { human: number | null; machine: number | null }[]) {
  const ids = rows.flatMap((row) => [row.human, row.machine]).filter((id): id is number => id !== null);
  const assets = new Map((await tx.audioAsset.findMany({ where: { id: { in: ids } }, select: { id: true, stale: true, listened_at: true } })).map((row) => [row.id, row]));
  let heard = 0;
  let total = 0;
  for (const row of rows) {
    const human = row.human !== null ? assets.get(row.human) : undefined;
    const machine = row.machine !== null ? assets.get(row.machine) : undefined;
    const playing = human && !human.stale ? human : machine && !machine.stale ? machine : null;
    if (!playing) continue;
    total++;
    if (playing.listened_at) heard++;
  }
  return { heard, total };
}

type Recording = { human: number | null; machine: number | null };
const phonicsRecordings = (lesson: { example_words: unknown; minimal_pairs: unknown; liaison_sentences: unknown }): Recording[] => {
  const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, number | null>[]) : []);
  const pick = (item: Record<string, number | null>, prefix = "") => ({ human: item[`${prefix}human_audio_id`] ?? null, machine: item[`${prefix}audio_id`] ?? null });
  return [
    ...list(lesson.example_words).map((item) => pick(item)),
    ...list(lesson.minimal_pairs).flatMap((item) => [pick(item, "a_"), pick(item, "b_")]),
    ...list(lesson.liaison_sentences).map((item) => pick(item)),
  ];
};

/** Share of sentence recordings a teacher hears from B1 up (PRD §13.4: a 20% sample). */
const SAMPLE_FROM_B1 = 0.2;

async function audioLine(tx: Tx, level: string, items: CheckedItem[], sentenceIds: number[]) {
  const ids = (slug: LibrarySlug) => items.filter((item) => item.slug === slug).map((item) => item.id);
  const [words, texts, sentences, lessons] = await Promise.all([
    tx.word.findMany({ where: { id: { in: ids("words") } }, select: { audio_id: true, human_audio_id: true } }),
    tx.text.findMany({ where: { id: { in: ids("texts") } }, select: { audio_id: true, human_audio_id: true } }),
    tx.sentence.findMany({ where: { id: { in: sentenceIds } }, select: { audio_id: true, human_audio_id: true } }),
    tx.phonicsLesson.findMany({ where: { id: { in: ids("phonics") } }, select: { example_words: true, minimal_pairs: true, liaison_sentences: true } }),
  ]);
  const recording = (row: { audio_id: number | null; human_audio_id: number | null }) => ({ human: row.human_audio_id, machine: row.audio_id });
  const groups = {
    words: await listening(tx, words.map(recording)),
    phonics: await listening(tx, lessons.flatMap(phonicsRecordings)),
    texts: await listening(tx, texts.map(recording)),
    sentences: await listening(tx, sentences.map(recording)),
  };
  const details: string[] = [];
  for (const kind of ["words", "phonics", "texts"] as const) {
    const left = groups[kind].total - groups[kind].heard;
    if (left > 0) details.push(t(`admin.publish.check.audio.${kind}`, { count: left }));
  }
  const { heard, total } = groups.sentences;
  // A1 and A2: every sentence. From B1: a sample of them.
  const sample = levelRank(level) >= levelRank("B1");
  const needed = sample ? Math.ceil(total * SAMPLE_FROM_B1) : total;
  if (heard < needed) details.push(t(sample ? "admin.publish.check.audio.sample" : "admin.publish.check.audio.sentences", { count: needed - heard }));
  return line("audio", "block", details.length === 0, details);
}

async function countsLine(tx: Tx, language: string, level: string) {
  const targets = (await appSetting<Record<string, LevelTargets>>(`targets.${language}`))[level];
  if (!targets) return null;
  const live = { language, status: "published" as const };
  const [words, phrases, units, texts, translations, dialogues, errorfix, writing] = await Promise.all([
    tx.word.count({ where: { ...live, level, pos: { not: "phrase" } } }),
    tx.word.count({ where: { ...live, level, pos: "phrase" } }),
    tx.grammarUnit.count({ where: { ...live, level } }),
    tx.text.count({ where: { ...live, level } }),
    tx.translateItem.count({ where: { ...live, grammar_unit: { level } } }),
    tx.dialogue.count({ where: { ...live, level } }),
    tx.errorfixItem.count({ where: { ...live, level } }),
    tx.writingTask.count({ where: { ...live, level } }),
  ]);
  const have: Record<keyof LevelTargets, number> = { words, phrases, grammar_units: units, texts, translations, dialogues, errorfix, writing };
  const short = (Object.keys(have) as (keyof LevelTargets)[])
    .filter((key) => targets[key] > 0 && have[key] < targets[key])
    .map((key) => t(`admin.publish.check.counts.${key}`, { count: have[key], goal: targets[key] }));
  return line("counts", "warn", short.length === 0, short);
}

/** The release checklist of one level, read now. */
export async function levelChecklist(language: string, level: string): Promise<CheckLine[]> {
  const tx = db;
  const items = await checkItems(tx, { language, statuses: ["published"], level });
  const failing = items.filter((item) => item.reasons.length > 0);
  const sentenceIds = await levelSentences(tx, language, level, items);

  const openRows = await tx.sentenceWord.count({
    where: { sentence_id: { in: sentenceIds }, OR: [{ candidate_reason: { not: null } }, { suspect: true }] },
  });
  const tokenItems = await Promise.all([
    tx.translateItem.findMany({ where: { id: { in: items.filter((item) => item.slug === "translations").map((item) => item.id) } }, select: { tokens: true } }),
    tx.errorfixItem.findMany({ where: { id: { in: items.filter((item) => item.slug === "errorfix").map((item) => item.id) } }, select: { tokens: true } }),
  ]);
  const openTokens = tokenItems
    .flat()
    .flatMap((row) => (Array.isArray(row.tokens) ? (row.tokens as { candidate_reason?: string | null; suspect?: boolean }[]) : []))
    .filter((token) => token.candidate_reason || token.suspect).length;

  const reports = await tx.contentReport.findMany({ where: { status: "open", priority: "high" }, select: { item_type: true, item_id: true, sentence_id: true } });
  const inLevel = new Set(items.map((item) => `${item.slug}:${item.id}`));
  const levelSentenceSet = new Set(sentenceIds);
  const urgent = reports.filter(
    (report) =>
      (reportTypes[report.item_type] && inLevel.has(`${reportTypes[report.item_type]}:${report.item_id}`)) ||
      (report.sentence_id !== null && levelSentenceSet.has(report.sentence_id)),
  ).length;

  const placement = await tx.text.count({ where: { language, level, status: "published", placement_ok: true } });
  const lines: CheckLine[] = [
    line("published", "block", items.length > 0, [], { count: items.length }),
    line(
      "items",
      "block",
      failing.length === 0,
      failing.slice(0, 5).map((item) => `${isolateLatin(item.title)}: ${item.reasons.join("، ")}`),
      { count: failing.length },
    ),
    line("open", "block", openRows + openTokens === 0, [], { count: openRows + openTokens }),
    line("reports", "block", urgent === 0, [], { count: urgent }),
    await audioLine(tx, level, items, sentenceIds),
    line("placement", "warn", placement > 0),
  ];
  const counts = await countsLine(tx, language, level);
  if (counts) lines.push(counts);
  return lines;
}

export async function languageState(language: string): Promise<LanguageState> {
  const [levels, releases, row] = await Promise.all([
    appSetting<string[]>(`levels.${language}`),
    db.levelRelease.findMany({ where: { language } }),
    db.language.findUnique({ where: { code: language }, select: { live: true } }),
  ]);
  const admins = await db.user.findMany({
    where: { id: { in: releases.map((release) => release.released_by).filter((id): id is number => id !== null) } },
    select: { id: true, phone: true },
  });
  const open = new Set(releases.map((release) => release.level));
  const states = await Promise.all(
    levels.map(async (level, index): Promise<LevelState> => {
      const release = releases.find((item) => item.level === level);
      const lowerOpen = index === 0 || open.has(levels[index - 1]);
      return {
        level,
        released: release ? { at: release.released_at, by: admins.find((admin) => admin.id === release.released_by)?.phone ?? null } : null,
        lines: release || lowerOpen ? await levelChecklist(language, level) : [],
        lowerOpen,
        higherOpen: index < levels.length - 1 && open.has(levels[index + 1]),
      };
    }),
  );
  return { live: row?.live ?? false, firstLevel: levels[0], firstOpen: open.has(levels[0]), levels: states };
}

export type ReleaseResult = { state: "done" } | { state: "blocked"; reason: "lower" | "higher" | "checklist" | "confirm" | "live" | "unknown" };

/** Opens or closes a level. Opening needs every blocking line met and, if warnings remain, `confirmed`. */
export async function setLevelRelease(language: string, level: string, open: boolean, confirmed: boolean, adminId: number): Promise<ReleaseResult> {
  const levels = await appSetting<string[]>(`levels.${language}`);
  const index = levels.indexOf(level);
  if (index < 0) return { state: "blocked", reason: "unknown" };
  const releases = new Set((await db.levelRelease.findMany({ where: { language } })).map((row) => row.level));
  if (releases.has(level) === open) return { state: "done" };

  if (open) {
    if (index > 0 && !releases.has(levels[index - 1])) return { state: "blocked", reason: "lower" };
    const lines = await levelChecklist(language, level);
    if (lines.some((item) => item.kind === "block" && !item.ok)) return { state: "blocked", reason: "checklist" };
    if (!confirmed && lines.some((item) => item.kind === "warn" && !item.ok)) return { state: "blocked", reason: "confirm" };
  } else {
    if (index < levels.length - 1 && releases.has(levels[index + 1])) return { state: "blocked", reason: "higher" };
    const live = (await db.language.findUnique({ where: { code: language }, select: { live: true } }))?.live;
    if (index === 0 && live) return { state: "blocked", reason: "live" };
  }

  await db.$transaction(async (tx) => {
    if (open) await tx.levelRelease.create({ data: { language, level, released_by: adminId } });
    else await tx.levelRelease.deleteMany({ where: { language, level } });
    await logChange(tx, adminId, { action: "release", entity: "level_release", entityId: `${language}:${level}`, before: { released: !open }, after: { released: open } });
  });
  return { state: "done" };
}

export type LiveResult = { state: "done" } | { state: "blocked"; reason: "firstLevel" };

/** Shows or hides a language in the app; showing needs its first level open. */
export async function setLanguageLive(language: string, live: boolean, adminId: number): Promise<LiveResult> {
  const levels = await appSetting<string[]>(`levels.${language}`);
  if (live && !(await db.levelRelease.findFirst({ where: { language, level: levels[0] } }))) return { state: "blocked", reason: "firstLevel" };
  const row = await db.language.findUnique({ where: { code: language }, select: { live: true } });
  if ((row?.live ?? false) === live) return { state: "done" };
  await db.$transaction(async (tx) => {
    await tx.language.upsert({ where: { code: language }, create: { code: language, live }, update: { live } });
    await logChange(tx, adminId, { action: "live", entity: "language", entityId: language, before: { live: !live }, after: { live } });
  });
  return { state: "done" };
}
