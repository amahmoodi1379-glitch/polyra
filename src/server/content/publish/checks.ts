import type { ContentStatus, TokenKind } from "@/generated/prisma/client";
import { t, type MessageKey } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { pronounKeys } from "@/schemas/conjugation";
import { engineNumber } from "@/server/settings/read";
import { correctedText } from "../kinds/errorfix";
import type { Tx } from "../kinds/types";
import { levelRank, type LanguageCode } from "../languages";
import { turnSentenceIds, type Voice } from "../library/list";
import type { LibrarySlug } from "../library/slugs";
import { questionRange, setNames, tracks } from "../text-check";

/**
 * The publish conditions of every content type (PRD §5.10, §6.7, §7.7, §13.5). An item counts the
 * items it depends on as ready when they are `approved` or `published`, so a word and its sentences
 * can be published in one run. Each unmet condition is one plain Persian line.
 */

export type CheckedItem = { slug: LibrarySlug; id: number; title: string; voice: Voice; level: string | null; status: ContentStatus; reasons: string[] };
export type CheckScope = { language: string; statuses: ContentStatus[]; level?: string };

/** What a dependency must be for an item to count it. */
export const readyStatuses: ContentStatus[] = ["approved", "published"];
const isReady = (status: ContentStatus | undefined) => status !== undefined && readyStatuses.includes(status);

const reason = (key: string, vars?: Record<string, string | number>) => isolateLatin(t(`admin.publish.reasons.${key}` as MessageKey, vars));
const listOf = (items: Iterable<string>, max = 4) => {
  const all = [...new Set(items)];
  const shown = all.slice(0, max).join("، ");
  return all.length > max ? t("admin.publish.reasons.andMore", { list: shown, count: all.length - max }) : shown;
};

type AudioState = "ok" | "missing" | "stale";
type SentenceFacts = {
  id: number;
  status: ContentStatus;
  translation: string;
  audio: AudioState;
  words: { word_id: number | null; kind: TokenKind; candidate: boolean; suspect: boolean }[];
};
type WordFacts = { lemma: string; level: string; status: ContentStatus };

/** Loads what the checks share once: audio, sentences and the words they use. */
class Loader {
  private audioRows = new Map<number, { stale: boolean }>();
  private sentenceRows = new Map<number, SentenceFacts | null>();
  private wordRows = new Map<number, WordFacts | null>();

  constructor(
    readonly tx: Tx,
    readonly language: string,
  ) {}

  async loadAudio(ids: (number | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number" && !this.audioRows.has(id)))];
    if (wanted.length === 0) return;
    const rows = await this.tx.audioAsset.findMany({ where: { id: { in: wanted } }, select: { id: true, stale: true } });
    for (const row of rows) this.audioRows.set(row.id, { stale: row.stale });
  }

  /** Human audio plays first; machine audio is the fallback (PRD §13.8). */
  audio(human: number | null | undefined, machine: number | null | undefined): AudioState {
    const own = human != null ? this.audioRows.get(human) : undefined;
    const tts = machine != null ? this.audioRows.get(machine) : undefined;
    if ((own && !own.stale) || (tts && !tts.stale)) return "ok";
    return own || tts ? "stale" : "missing";
  }

  async sentences(ids: number[]) {
    const wanted = [...new Set(ids.filter((id) => !this.sentenceRows.has(id)))];
    if (wanted.length > 0) {
      const rows = await this.tx.sentence.findMany({
        where: { id: { in: wanted } },
        select: {
          id: true,
          status: true,
          translation_fa: true,
          audio_id: true,
          human_audio_id: true,
          words: { select: { word_id: true, kind: true, candidate_reason: true, suspect: true } },
        },
      });
      await this.loadAudio(rows.flatMap((row) => [row.audio_id, row.human_audio_id]));
      for (const id of wanted) this.sentenceRows.set(id, null);
      for (const row of rows) {
        this.sentenceRows.set(row.id, {
          id: row.id,
          status: row.status,
          translation: row.translation_fa.trim(),
          audio: this.audio(row.human_audio_id, row.audio_id),
          words: row.words.map((word) => ({ word_id: word.word_id, kind: word.kind, candidate: Boolean(word.candidate_reason), suspect: word.suspect })),
        });
      }
      await this.words(rows.flatMap((row) => row.words.map((word) => word.word_id)));
    }
    return ids.map((id) => this.sentenceRows.get(id) ?? null);
  }

  async words(ids: (number | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number" && !this.wordRows.has(id)))];
    if (wanted.length > 0) {
      const rows = await this.tx.word.findMany({ where: { id: { in: wanted } }, select: { id: true, lemma: true, level: true, status: true } });
      for (const id of wanted) this.wordRows.set(id, null);
      for (const row of rows) this.wordRows.set(row.id, { lemma: row.lemma, level: row.level, status: row.status });
    }
    return ids.map((id) => (typeof id === "number" ? (this.wordRows.get(id) ?? null) : null));
  }

  word(id: number) {
    return this.wordRows.get(id) ?? null;
  }
}

/** Problems of a group of sentences (one sentence, or all of a text or a dialogue), counted. */
class SentenceIssues {
  gone = 0;
  noTranslation = 0;
  noAudio = 0;
  staleAudio = 0;
  candidates = 0;
  suspects = 0;
  unready = new Set<string>();

  add(facts: SentenceFacts | null, loader: Loader) {
    if (!facts || facts.status === "retired") {
      this.gone++;
      return;
    }
    if (!facts.translation) this.noTranslation++;
    if (facts.audio === "missing") this.noAudio++;
    if (facts.audio === "stale") this.staleAudio++;
    this.addTokens(facts.words, loader);
  }

  /** Open rows and words not approved yet, from sentence_word rows or a stored token list. */
  addTokens(rows: { word_id?: number | null; kind?: string; candidate?: boolean; suspect?: boolean }[], loader: Loader) {
    for (const row of rows) {
      if (row.candidate) this.candidates++;
      else if (row.suspect) this.suspects++;
      if (row.kind === "word" && row.word_id) {
        const word = loader.word(row.word_id);
        if (!word || !isReady(word.status)) this.unready.add(word?.lemma ?? `#${row.word_id}`);
      }
    }
  }

  reasons(single: boolean) {
    const lines: string[] = [];
    const count = (key: string, value: number) => {
      if (value > 0) lines.push(single ? reason(key) : reason(`${key}Many`, { count: value }));
    };
    if (this.gone) lines.push(reason("sentenceGone", { count: this.gone }));
    count("noTranslation", this.noTranslation);
    count("noAudio", this.noAudio);
    count("staleAudio", this.staleAudio);
    if (this.candidates) lines.push(reason("candidates", { count: this.candidates }));
    if (this.suspects) lines.push(reason("suspects", { count: this.suspects }));
    if (this.unready.size) lines.push(reason("wordsNotReady", { words: listOf(this.unready) }));
    return lines;
  }
}

/** Token lists stored as JSON (short translations, find-the-mistake texts). */
const storedTokens = (value: unknown) =>
  (Array.isArray(value) ? (value as { word_id?: number | null; kind?: string; candidate_reason?: string | null; suspect?: boolean }[]) : []).map((row) => ({
    word_id: row.word_id ?? null,
    kind: row.kind ?? "word",
    candidate: Boolean(row.candidate_reason),
    suspect: Boolean(row.suspect),
  }));

function audioReason(state: AudioState, missingKey = "noAudio", staleKey = "staleAudio") {
  return state === "ok" ? [] : [reason(state === "missing" ? missingKey : staleKey)];
}

type Ready = { units: Map<string, { id: number; status: ContentStatus; level: string }> };

async function words(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  const { tx, language } = loader;
  const rows = await tx.word.findMany({
    where: { language, status: { in: scope.statuses }, ...(scope.level ? { level: scope.level } : {}) },
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
      no_card: true,
      dup_of_id: true,
      audio_id: true,
      human_audio_id: true,
    },
  });
  if (rows.length === 0) return [];
  const min = await engineNumber("publish.word_min_targets");
  const targets = await tx.sentenceTarget.groupBy({
    by: ["target_id"],
    where: { target_type: "word", target_id: { in: rows.map((row) => row.id) }, status: { not: "retired" }, sentence: { status: { in: readyStatuses } } },
    _count: true,
  });
  const counts = new Map(targets.map((row) => [row.target_id, row._count]));
  await loader.loadAudio(rows.flatMap((row) => [row.audio_id, row.human_audio_id]));
  return rows.map((word) => {
    const reasons: string[] = [];
    if (word.dup_of_id) reasons.push(reason("duplicate"));
    if (!word.meaning_fa) reasons.push(reason("noMeaning"));
    if (word.pos === "noun" && !word.gender) reasons.push(reason("noGender"));
    if (language === "de" && word.pos === "noun" && word.number === "sg" && !word.plural) reasons.push(reason("noPlural"));
    reasons.push(...audioReason(loader.audio(word.human_audio_id, word.audio_id)));
    const count = counts.get(word.id) ?? 0;
    if (!word.no_card && count < min) reasons.push(reason("wordTargets", { count, min }));
    return { slug: "words", id: word.id, title: word.lemma, voice: "target", level: word.level, status: word.status, reasons };
  });
}

async function sentences(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  const rows = await loader.tx.sentence.findMany({
    where: { language: loader.language, status: { in: scope.statuses }, ...(scope.level ? { level: scope.level } : {}) },
    orderBy: { id: "asc" },
    select: { id: true, text: true, level: true, status: true },
  });
  const facts = await loader.sentences(rows.map((row) => row.id));
  return rows.map((row, index) => {
    const issues = new SentenceIssues();
    issues.add(facts[index], loader);
    return { slug: "sentences", id: row.id, title: row.text, voice: "target", level: row.level, status: row.status, reasons: issues.reasons(true) };
  });
}

async function units(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  const { tx, language } = loader;
  const rows = await tx.grammarUnit.findMany({
    where: { language, status: { in: scope.statuses }, ...(scope.level ? { level: scope.level } : {}) },
    orderBy: [{ level: "asc" }, { order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true, title_fa: true, level: true, status: true, lesson_fa: true, rule_line_fa: true, example_sentence_ids: true },
  });
  if (rows.length === 0) return [];
  const min = await engineNumber("publish.unit_min_targets");
  const targets = await tx.sentenceTarget.findMany({
    where: { target_type: "grammar", target_id: { in: rows.map((row) => row.id) }, status: { not: "retired" } },
    select: { target_id: true, sentence_id: true },
  });
  await loader.sentences([...rows.flatMap((row) => row.example_sentence_ids), ...targets.map((row) => row.sentence_id)]);
  const ready = (facts: SentenceFacts | null): facts is SentenceFacts => facts !== null && isReady(facts.status);
  return Promise.all(
    rows.map(async (unit) => {
      const reasons: string[] = [];
      if (!unit.lesson_fa?.trim()) reasons.push(reason("noLesson"));
      if (!unit.rule_line_fa?.trim()) reasons.push(reason("noRule"));
      const examples = (await loader.sentences(unit.example_sentence_ids)).filter(ready);
      if (examples.length < 3) reasons.push(reason("examples", { count: examples.length }));
      const own = targets.filter((row) => row.target_id === unit.id).map((row) => row.sentence_id);
      const counted = (await loader.sentences(own)).filter(ready).filter((facts) => facts.audio === "ok");
      if (counted.length < min) reasons.push(reason("unitTargets", { count: counted.length, min }));
      // Every word of its sentences is of the unit's level or lower (PRD §6.7).
      const above = new Set<string>();
      for (const facts of [...examples, ...counted]) {
        for (const row of facts.words) {
          const word = row.word_id ? loader.word(row.word_id) : null;
          if (word && levelRank(word.level) > levelRank(unit.level)) above.add(word.lemma);
        }
      }
      if (above.size) reasons.push(reason("wordsAboveLevel", { level: unit.level, words: listOf(above) }));
      return { slug: "units" as const, id: unit.id, title: unit.title_fa, voice: "fa" as const, level: unit.level, status: unit.status, reasons };
    }),
  );
}

function unitReasons(codes: (string | null)[], ready: Ready) {
  const missing = codes.filter((code): code is string => Boolean(code) && !isReady(ready.units.get(code!)?.status));
  return missing.length ? [reason("unitNotReady", { units: listOf(missing) })] : [];
}

async function tables(loader: Loader, scope: CheckScope, ready: Ready): Promise<CheckedItem[]> {
  const rows = await loader.tx.conjugationTable.findMany({
    where: { language: loader.language, status: { in: scope.statuses }, ...(scope.level ? { word: { level: scope.level } } : {}) },
    orderBy: { id: "asc" },
    select: { id: true, tense: true, forms: true, unit_code: true, status: true, word: { select: { lemma: true, level: true, status: true } } },
  });
  const keys = pronounKeys[loader.language as LanguageCode] ?? [];
  return rows.map((row) => {
    const forms = (row.forms ?? {}) as Record<string, string>;
    const empty = keys.filter((key) => !forms[key]?.trim()).length;
    const reasons: string[] = [];
    if (empty) reasons.push(reason("emptyForms", { count: empty }));
    if (!isReady(row.word.status)) reasons.push(reason("verbNotReady", { verb: row.word.lemma }));
    reasons.push(...unitReasons([row.unit_code], ready));
    return { slug: "tables", id: row.id, title: `${row.word.lemma} · ${row.tense}`, voice: "target", level: row.word.level, status: row.status, reasons };
  });
}

async function transforms(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  const rows = await loader.tx.transformItem.findMany({
    where: { language: loader.language, status: { in: scope.statuses }, ...(scope.level ? { grammar_unit: { level: scope.level } } : {}) },
    orderBy: { id: "asc" },
    select: { id: true, source_sentence: true, accepted_outputs: true, status: true, grammar_unit: { select: { unit_code: true, level: true, status: true } } },
  });
  return rows.map((row) => {
    const reasons: string[] = [];
    if (!row.accepted_outputs.some((output) => output.trim())) reasons.push(reason("noAnswer"));
    if (!isReady(row.grammar_unit.status)) reasons.push(reason("unitNotReady", { units: row.grammar_unit.unit_code }));
    return { slug: "transforms", id: row.id, title: row.source_sentence, voice: "target", level: row.grammar_unit.level, status: row.status, reasons };
  });
}

async function translations(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  const rows = await loader.tx.translateItem.findMany({
    where: { language: loader.language, status: { in: scope.statuses }, ...(scope.level ? { grammar_unit: { level: scope.level } } : {}) },
    orderBy: { id: "asc" },
    select: { id: true, prompt_fa: true, accepted_outputs: true, tokens: true, status: true, grammar_unit: { select: { unit_code: true, level: true, status: true } } },
  });
  await loader.words(rows.flatMap((row) => storedTokens(row.tokens).map((token) => token.word_id)));
  return rows.map((row) => {
    const issues = new SentenceIssues();
    issues.addTokens(storedTokens(row.tokens), loader);
    const reasons = issues.reasons(true);
    if (!row.accepted_outputs.some((output) => output.trim())) reasons.unshift(reason("noAnswer"));
    if (!isReady(row.grammar_unit.status)) reasons.push(reason("unitNotReady", { units: row.grammar_unit.unit_code }));
    return { slug: "translations", id: row.id, title: row.prompt_fa, voice: "fa", level: row.grammar_unit.level, status: row.status, reasons };
  });
}

async function texts(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  const { tx } = loader;
  const rows = await tx.text.findMany({
    where: { language: loader.language, status: { in: scope.statuses }, ...(scope.level ? { level: scope.level } : {}) },
    orderBy: [{ level: "asc" }, { code: "asc" }],
    select: {
      id: true,
      title: true,
      level: true,
      band: true,
      status: true,
      placement_ok: true,
      sentence_ids: true,
      audio_id: true,
      human_audio_id: true,
      sentence_offsets_ms: true,
      human_sentence_offsets_ms: true,
      questions: { where: { status: { not: "retired" } }, select: { track: true, set: true } },
    },
  });
  await loader.sentences(rows.flatMap((row) => row.sentence_ids));
  await loader.loadAudio(rows.flatMap((row) => [row.audio_id, row.human_audio_id]));
  return Promise.all(
    rows.map(async (text) => {
      const issues = new SentenceIssues();
      for (const facts of await loader.sentences(text.sentence_ids)) issues.add(facts, loader);
      const reasons = issues.reasons(false);
      // A whole-text file with the start of every sentence (PRD §7.7): the human one or the machine one.
      const count = text.sentence_ids.length;
      const human = loader.audio(text.human_audio_id, null) === "ok" && text.human_sentence_offsets_ms.length === count;
      const machine = loader.audio(null, text.audio_id) === "ok" && text.sentence_offsets_ms.length === count;
      if (!human && !machine) reasons.push(reason(loader.audio(text.human_audio_id, text.audio_id) === "stale" ? "textAudioStale" : "textAudio"));
      for (const track of tracks) {
        for (const set of setNames) {
          const found = text.questions.filter((question) => question.track === track && question.set === set).length;
          const [min, max] = questionRange(text.band, set, text.placement_ok);
          if (found < min || found > max) reasons.push(reason("questions", { track: t(`admin.publish.tracks.${track}`), set, count: found, min, max }));
        }
      }
      return { slug: "texts" as const, id: text.id, title: text.title, voice: "target" as const, level: text.level, status: text.status, reasons };
    }),
  );
}

async function dialogues(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  const rows = await loader.tx.dialogue.findMany({
    where: { language: loader.language, status: { in: scope.statuses }, ...(scope.level ? { level: scope.level } : {}) },
    orderBy: [{ level: "asc" }, { code: "asc" }],
    select: { id: true, title_fa: true, level: true, status: true, turns: true },
  });
  await loader.sentences(rows.flatMap((row) => turnSentenceIds(row.turns)));
  return Promise.all(
    rows.map(async (row) => {
      const issues = new SentenceIssues();
      for (const facts of await loader.sentences(turnSentenceIds(row.turns))) issues.add(facts, loader);
      return { slug: "dialogues" as const, id: row.id, title: row.title_fa, voice: "fa" as const, level: row.level, status: row.status, reasons: issues.reasons(false) };
    }),
  );
}

async function errorfix(loader: Loader, scope: CheckScope, ready: Ready): Promise<CheckedItem[]> {
  const rows = await loader.tx.errorfixItem.findMany({
    where: { language: loader.language, status: { in: scope.statuses }, ...(scope.level ? { level: scope.level } : {}) },
    orderBy: { id: "asc" },
    select: { id: true, marked_text: true, level: true, status: true, unit_codes: true, tokens: true },
  });
  await loader.words(rows.flatMap((row) => storedTokens(row.tokens).map((token) => token.word_id)));
  return rows.map((row) => {
    const issues = new SentenceIssues();
    issues.addTokens(storedTokens(row.tokens), loader);
    return {
      slug: "errorfix",
      id: row.id,
      title: correctedText(row.marked_text),
      voice: "target",
      level: row.level,
      status: row.status,
      reasons: [...issues.reasons(true), ...unitReasons(row.unit_codes, ready)],
    };
  });
}

async function writing(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  const rows = await loader.tx.writingTask.findMany({
    where: { language: loader.language, status: { in: scope.statuses }, ...(scope.level ? { level: scope.level } : {}) },
    orderBy: { id: "asc" },
    select: { id: true, prompt_fa: true, level: true, status: true },
  });
  return rows.map((row) => ({ slug: "writing", id: row.id, title: row.prompt_fa, voice: "fa", level: row.level, status: row.status, reasons: [] }));
}

type Voiced = Record<string, unknown>;
/** The recordings a phonics lesson needs: each example word, both sides of each pair, each liaison sentence. */
function phonicsAudio(lesson: { example_words: unknown; minimal_pairs: unknown; liaison_sentences: unknown }) {
  const list = (value: unknown) => (Array.isArray(value) ? (value as Voiced[]) : []);
  const ids = (item: Voiced, prefix = "") => [item[`${prefix}human_audio_id`] as number | null, item[`${prefix}audio_id`] as number | null] as const;
  return [
    ...list(lesson.example_words).map((item) => ids(item)),
    ...list(lesson.minimal_pairs).flatMap((item) => [ids(item, "a_"), ids(item, "b_")]),
    ...list(lesson.liaison_sentences).map((item) => ids(item)),
  ];
}

async function phonics(loader: Loader, scope: CheckScope): Promise<CheckedItem[]> {
  // Phonics lessons belong to the language, and they open with A1.
  if (scope.level && scope.level !== "A1") return [];
  const rows = await loader.tx.phonicsLesson.findMany({
    where: { language: loader.language, status: { in: scope.statuses } },
    orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true, sound_label: true, status: true, example_words: true, minimal_pairs: true, liaison_sentences: true },
  });
  await loader.loadAudio(rows.flatMap((row) => phonicsAudio(row).flat()));
  return rows.map((row) => {
    const states = phonicsAudio(row).map(([human, machine]) => loader.audio(human, machine));
    const missing = states.filter((state) => state === "missing").length;
    const stale = states.filter((state) => state === "stale").length;
    const reasons: string[] = [];
    if (missing) reasons.push(reason("recordingsMissing", { count: missing }));
    if (stale) reasons.push(reason("recordingsStale", { count: stale }));
    return { slug: "phonics", id: row.id, title: row.sound_label, voice: "fa", level: null, status: row.status, reasons };
  });
}

/** Every item of the scope, checked, in the library's type order. */
export async function checkItems(tx: Tx, scope: CheckScope): Promise<CheckedItem[]> {
  const loader = new Loader(tx, scope.language);
  const unitRows = await tx.grammarUnit.findMany({ where: { language: scope.language }, select: { id: true, unit_code: true, status: true, level: true } });
  const ready: Ready = { units: new Map(unitRows.map((row) => [row.unit_code, row])) };
  const lists = [
    await words(loader, scope),
    await sentences(loader, scope),
    await units(loader, scope),
    await tables(loader, scope, ready),
    await transforms(loader, scope),
    await translations(loader, scope),
    await texts(loader, scope),
    await dialogues(loader, scope),
    await errorfix(loader, scope, ready),
    await writing(loader, scope),
    await phonics(loader, scope),
  ];
  return lists.flat();
}
