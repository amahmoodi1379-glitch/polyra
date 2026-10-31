import {
  indexContent,
  type ConjC,
  type Content,
  type Gender,
  type Pos,
  type QuestionC,
  type SentenceC,
  type Speak,
  type TargetC,
  type TextC,
  type TokenC,
  type UnitC,
  type WordC,
} from "@/engine/content";
import type { Lang } from "@/engine/text";
import type { ContentStatus } from "@/generated/prisma/client";
import { spokenWord } from "@/lib/spoken";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";

/**
 * The content a learner may see, in the engine's shape (PRD §4.1, §13.5): published and not
 * suspended, texts only of released levels; a tester or an admin also sees approved content, in every level (PRD §13.5,
 * «حساب آزمایش‌کننده»). Kept in memory for a short while, since every session build needs it.
 */

/** `review` is «بازبینی» in the panel: drafts too, every level, never cached (src/server/content/review/preview.ts). */
export type Audience = "public" | "tester" | "review";

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; content: Promise<Content> }>();

export function learnerContent(language: string, audience: Audience): Promise<Content> {
  const key = `${language}:${audience}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.content;
  const content = loadContent(language, audience);
  cache.set(key, { at: Date.now(), content });
  content.catch(() => cache.delete(key));
  return content;
}

/** Forgets the cached content, after the tester's demo content is loaded or removed. */
export function forgetContent() {
  cache.clear();
}

const MEANING_SPLIT = /[،,]/;

export async function loadContent(language: string, audience: Audience): Promise<Content> {
  const statuses: ContentStatus[] = audience === "review" ? ["draft", "needs_review", "approved", "published"] : audience === "tester" ? ["approved", "published"] : ["published"];
  const visible = { language, status: { in: statuses }, suspended: false };
  const levels = await appSetting<string[]>(`levels.${language}`);
  const released = audience !== "public" ? levels : (await db.levelRelease.findMany({ where: { language }, select: { level: true } })).map((row) => row.level);

  const [wordRows, sentenceRows, targetRows, unitRows, transformRows, translateRows, conjRows, texts, dialogues] = await Promise.all([
    db.word.findMany({ where: { ...visible, meaning_fa: { not: null } } }),
    db.sentence.findMany({ where: visible, include: { words: { orderBy: { position: "asc" } } } }),
    db.sentenceTarget.findMany({ where: visible }),
    db.grammarUnit.findMany({ where: visible }),
    db.transformItem.findMany({ where: visible }),
    db.translateItem.findMany({ where: visible }),
    db.conjugationTable.findMany({ where: visible }),
    db.text.findMany({ where: { language }, include: { questions: { where: { status: { in: statuses }, suspended: false }, orderBy: { order_no: "asc" } } } }),
    db.dialogue.findMany({ where: { language }, select: { turns: true } }),
  ]);

  const assetIds = [...wordRows, ...sentenceRows, ...texts].flatMap((row) => [row.audio_id, row.human_audio_id]).filter((id): id is number => id !== null);
  const assetRows = await db.audioAsset.findMany({ where: { id: { in: assetIds }, stale: false }, select: { id: true, url: true, duration_ms: true } });
  const assets = new Map(assetRows.map((row) => [row.id, row.url]));
  const durations = new Map(assetRows.map((row) => [row.id, row.duration_ms]));
  /** The file learners hear: the teacher's recording first, never a stale one (PRD §13.8). */
  const fileOf = (row: { audio_id: number | null; human_audio_id: number | null }) =>
    (row.human_audio_id !== null && assets.get(row.human_audio_id)) || (row.audio_id !== null && assets.get(row.audio_id)) || null;
  const lang = language as Lang;

  const words = new Map<number, WordC>();
  for (const row of wordRows) {
    const speak: Speak = { text: spokenWord(row), lang, url: fileOf(row) };
    words.set(row.id, {
      id: row.id,
      code: row.code,
      lemma: row.lemma,
      pos: row.pos as Pos,
      gender: (row.gender as Gender | null) ?? null,
      number: row.number === "pl_only" ? "pl_only" : row.number === "sg" ? "sg" : null,
      plural: row.plural,
      register: row.register,
      conceptId: row.concept_id,
      meanings: (row.meaning_fa ?? "")
        .split(MEANING_SPLIT)
        .map((part) => part.trim())
        .filter(Boolean),
      level: row.level,
      introOrder: row.intro_order ?? Number.MAX_SAFE_INTEGER,
      noCard: row.no_card,
      mastery: row.mastery,
      senseOf: row.sense_of,
      parts: row.parts,
      homophones: row.homophones,
      image: row.image,
      noteFa: row.note_fa,
      family: row.family,
      collocations: Array.isArray(row.collocations) ? (row.collocations as { text: string; translation_fa: string }[]) : [],
      speak,
    });
  }

  // Sentences of texts and dialogues are not part of the vocabulary and grammar bank (PRD §5.7).
  const notBank = new Set<number>(texts.flatMap((text) => text.sentence_ids));
  for (const dialogue of dialogues) {
    for (const turn of Array.isArray(dialogue.turns) ? (dialogue.turns as { sentence_id?: number; choices?: { sentence_id?: number }[] }[]) : []) {
      if (turn.sentence_id) notBank.add(turn.sentence_id);
      for (const choice of turn.choices ?? []) if (choice.sentence_id) notBank.add(choice.sentence_id);
    }
  }
  const sentences = new Map<number, SentenceC>();
  for (const row of sentenceRows) {
    // A sentence with a word the learner cannot see yet is left out (its candidates are unresolved).
    if (row.words.some((token) => token.kind === "word" && (token.word_id === null || !words.has(token.word_id)))) continue;
    const tokens: TokenC[] = row.words.map((token) => ({
      kind: token.kind,
      wordId: token.word_id,
      surface: token.surface,
      spans: (Array.isArray(token.spans) ? token.spans : []) as [number, number][],
      meaningCtx: token.meaning_fa_ctx,
    }));
    sentences.set(row.id, {
      id: row.id,
      text: row.text,
      translationFa: row.translation_fa,
      level: row.level,
      speak: { text: row.tts_text ?? row.text, lang, url: fileOf(row) },
      tokens,
      bank: !notBank.has(row.id),
    });
  }

  const units: UnitC[] = unitRows.map((row) => ({
    id: row.id,
    unitCode: row.unit_code,
    orderNo: row.order_no ?? Number.MAX_SAFE_INTEGER,
    titleFa: row.title_fa,
    level: row.level,
    lessonFa: row.lesson_fa ?? "",
    buildTable: Array.isArray(row.build_table) ? (row.build_table as string[][]) : null,
    exampleSentenceIds: row.example_sentence_ids.filter((id) => sentences.has(id)),
    ruleLineFa: row.rule_line_fa ?? "",
    commonMistakeFa: row.common_mistake_fa,
    canDoFa: row.can_do_fa,
    categorySets: Array.isArray(row.category_sets) ? (row.category_sets as { name: string; items: string[] }[]) : null,
  }));
  const unitIds = new Set(units.map((unit) => unit.id));

  const targets = new Map<number, TargetC>();
  for (const row of targetRows) {
    if (!sentences.has(row.sentence_id)) continue;
    const type = row.target_type === "word" ? "word" : "grammar";
    if (type === "word" ? !words.has(row.target_id) : !unitIds.has(row.target_id)) continue;
    targets.set(row.id, {
      id: row.id,
      sentenceId: row.sentence_id,
      type,
      targetId: row.target_id,
      markedText: row.marked_text,
      blanks: row.blanks === 2 ? 2 : 1,
      accepted: row.accepted as string[] | string[][],
      distractors: row.distractors as string[] | string[][],
      hint: row.hint,
      acceptedFull: Array.isArray(row.accepted_full) ? (row.accepted_full as string[]) : null,
    });
  }

  const conjugations: ConjC[] = conjRows
    .filter((row) => words.has(row.word_id))
    .map((row) => ({
      id: row.id,
      wordId: row.word_id,
      tense: row.tense,
      unitCode: row.unit_code,
      forms: row.forms as Record<string, string>,
      variants: (row.accepted_variants ?? {}) as Record<string, string[]>,
      reviewCard: row.review_card,
    }));

  const openLevels = levels.filter((level) => released.includes(level));
  return indexContent({
    language: lang,
    levels,
    openLevels,
    words,
    sentences,
    targets,
    units,
    transforms: transformRows
      .filter((row) => unitIds.has(row.grammar_unit_id))
      .map((row) => ({ id: row.id, unitId: row.grammar_unit_id, instructionFa: row.instruction_fa, source: row.source_sentence, outputs: row.accepted_outputs })),
    translates: translateRows
      .filter((row) => unitIds.has(row.grammar_unit_id))
      .map((row) => ({ id: row.id, unitId: row.grammar_unit_id, promptFa: row.prompt_fa, outputs: row.accepted_outputs })),
    conjugations,
    texts: texts
      .filter((row) => statuses.includes(row.status) && !row.suspended && openLevels.includes(row.level) && row.sentence_ids.every((id) => sentences.has(id)))
      .map((row) => textOf(row, { sentences, words, assets, durations })),
  });
}

type TextRow = Awaited<ReturnType<typeof db.text.findMany<{ include: { questions: true } }>>>[number];

/**
 * A text in the engine's shape (PRD §7.2): the teacher's recording first with its own sentence starts,
 * never a stale file; without one the device voice reads it (DECISIONS.md). Its questions by track
 * and set, in order.
 */
function textOf(
  row: TextRow,
  known: { sentences: Map<number, SentenceC>; words: Map<number, WordC>; assets: Map<number, string>; durations: Map<number, number | null> },
): TextC {
  const human = row.human_audio_id !== null && known.assets.has(row.human_audio_id) ? row.human_audio_id : null;
  const file = human ?? (row.audio_id !== null && known.assets.has(row.audio_id) ? row.audio_id : null);
  const offsets = human !== null ? row.human_sentence_offsets_ms : row.sentence_offsets_ms;
  const durationMs = file !== null ? known.durations.get(file) : null;
  const questions: TextC["questions"] = { listening: { A: [], B: [] }, reading: { A: [], B: [] } };
  for (const question of row.questions) {
    const parsed = questionOf(question);
    if (parsed) questions[question.track][question.set].push(parsed);
  }
  const tokens = row.sentence_ids.flatMap((id) => known.sentences.get(id)?.tokens ?? []);
  return {
    id: row.id,
    code: row.code,
    level: row.level,
    band: row.band,
    kind: row.kind,
    title: row.title,
    sentenceIds: row.sentence_ids,
    speakers: Array.isArray(row.speakers) ? (row.speakers as (string | null)[]) : null,
    audio:
      file !== null && durationMs
        ? { url: known.assets.get(file)!, offsetsMs: offsets.length === row.sentence_ids.length ? offsets : [], durationSec: durationMs / 1000 }
        : null,
    wordCount: row.word_count ?? tokens.filter((token) => token.kind === "word").length,
    keyWordIds: row.key_word_ids.filter((id) => known.words.has(id)),
    placementOk: row.placement_ok,
    difficulty: row.difficulty_score ?? 0,
    orderOverride: row.order_override,
    questions,
  };
}

/** A stored question (its payload is the import's fields without `type`, PRD §14.3) in the engine's shape; null when it does not read. */
function questionOf(row: TextRow["questions"][number]): QuestionC | null {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const base = { id: row.id, prompt: typeof p.prompt === "string" ? p.prompt : "", promptFa: typeof p.prompt_fa === "string" ? p.prompt_fa : null, explanationFa: row.explanation_fa };
  const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  const ints = (value: unknown) => (Array.isArray(value) ? value.map(Number) : []);
  switch (row.type) {
    case "mcq":
      return { ...base, type: "mcq", options: strings(p.options), correct: Number(p.correct) };
    case "tf":
      return { ...base, type: "tf", correct: p.correct === true };
    case "order":
      return { ...base, type: "order", items: strings(p.items), correctOrder: ints(p.correct_order) };
    case "match":
      return { ...base, type: "match", left: strings(p.left), right: strings(p.right), pairs: (Array.isArray(p.pairs) ? p.pairs : []).map((pair) => ints(pair) as [number, number]) };
    case "cloze":
      return { ...base, type: "cloze", textWithGaps: String(p.text_with_gaps ?? ""), bank: strings(p.bank), answers: strings(p.answers) };
    case "find":
      return { ...base, type: "find", correctSentence: Number(p.correct_sentence) };
    case "ctx":
      return { ...base, type: "ctx", word: String(p.word ?? ""), options: strings(p.options), correct: Number(p.correct) };
    case "num":
      return { ...base, type: "num", answer: String(p.answer ?? ""), accepted: strings(p.accepted) };
    case "dict":
      return { ...base, type: "dict", sentence: Number(p.sentence) };
    default:
      return null;
  }
}
