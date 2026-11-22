import type { PhonicsKind } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { phonicsLessonRecord } from "@/schemas/phonics";
import { dialogueRecord, dialogueTurn, errorfixRecord, writingRecord } from "@/schemas/speaking";
import { textRecord, textSentence } from "@/schemas/texts";
import { appSettingDefaults } from "@/server/settings/app-catalog";
import { levelRank } from "../languages";
import { checkLesson, checkMarks, checkWriting, correctedText, DIALOGUE_A1_WORDS, DIALOGUE_CHOICES, DIALOGUE_TURNS, samePhonics, wordCount, type Range } from "../practice-check";
import { describeProblem, zodProblems, type Problem } from "../problems";
import { checkQuestionSets } from "../text-check";
import type { Analyzer, Token } from "./analyze";
import { formExceptions } from "./sentences";
import type { PackWord } from "./words";

/**
 * Texts, dialogues, find-the-mistake texts, writing tasks and phonics lessons of a pack (owner, 18 Nov
 * 2026; format in content/README.md). Each is a JSON file written like the chatbots' answers
 * (prompts/v2/examples/P-T, P-D, P-E, P-WR, P-H) without `tokens`: the builder maps every word of every
 * sentence as it does for the sentence files, so a sentence uses only words of the lists, of its level
 * or lower (and, for the first A1 texts and the A1 dialogues, only the first words of the teaching order).
 * The importers' own schemas and rules run here too, so what the checker passes the server loads.
 */

type Note = { file: string; line: number; text: string };
type Exception = { code: string; surface: string };
type Json = Record<string, unknown>;
export type JsonFile = { file: string; text: string };

type TextKindEntry = { kind: string; name_fa: string; speakers: boolean };
type Tier = { texts: number; words: number; length?: Range; kind?: string };
type PlannedLesson = { label: string; kind: PhonicsKind };

/** The general settings these items follow; the defaults when there is no database. */
export type ItemSettings = {
  textBands: Record<string, Range>;
  levelBands: Record<string, number[]>;
  textKinds: Record<string, TextKindEntry[]>;
  firstTexts: Tier[];
  placementTexts: number;
  writingWords: Record<string, Range>;
  phonicsLessons: PlannedLesson[];
};

export const ITEM_SETTING_KEYS = {
  textBands: "prompt.text_bands",
  levelBands: "prompt.text_level_bands",
  textKinds: "prompt.text_kinds",
  firstTexts: "prompt.first_texts",
  placementTexts: "prompt.placement_texts",
  writingWords: "prompt.writing_words",
} as const;

export function itemSettings(language: string, values: Partial<Record<string, unknown>> = {}): ItemSettings {
  const read = <T>(key: string) => (values[key] ?? appSettingDefaults[key]) as T;
  return {
    textBands: read(ITEM_SETTING_KEYS.textBands),
    levelBands: read(ITEM_SETTING_KEYS.levelBands),
    textKinds: read(ITEM_SETTING_KEYS.textKinds),
    firstTexts: read(ITEM_SETTING_KEYS.firstTexts),
    placementTexts: read(ITEM_SETTING_KEYS.placementTexts),
    writingWords: read(ITEM_SETTING_KEYS.writingWords),
    phonicsLessons: read(`phonics.lessons.${language}`),
  };
}

/** One text, ready for the P-T importer: `spec` and `length` are the batch's params. */
export type PackText = { file: string; code: string; level: string; band: number; length: Range; tierWords: number | null; placement_ok: boolean; kind: string; record: Json; codes: string[] };
export type PackDialogue = { file: string; code: string; level: string; situation: string; record: Json; codes: string[] };
export type PackErrorfix = { file: string; key: string; level: string; record: Json; codes: string[]; units: string[] };
export type PackWriting = { file: string; key: string; level: string; record: Json };
export type PackPhonics = { file: string; label: string; kind: PhonicsKind; order_no: number; record: Json };

export type BuiltItems = {
  texts: PackText[];
  dialogues: PackDialogue[];
  errorfix: PackErrorfix[];
  writing: PackWriting[];
  errors: Note[];
  notes: Note[];
  exceptions: Exception[];
};

/** The line where a value first appears in a file, for the error's place; 1 when it is not found. */
function lineOf(raw: string, value: unknown) {
  if (typeof value !== "string" || value === "") return 1;
  const at = raw.indexOf(JSON.stringify(value).slice(1, -1));
  return at < 0 ? 1 : raw.slice(0, at).split("\n").length;
}

/** The file's JSON, or an error with its line. */
function parseJson(file: JsonFile, errors: Note[]): unknown {
  try {
    return JSON.parse(file.text);
  } catch (error) {
    const message = (error as Error).message;
    const position = /position (\d+)/.exec(message);
    const line = /line (\d+)/.exec(message);
    errors.push({ file: file.file, line: line ? Number(line[1]) : position ? file.text.slice(0, Number(position[1])).split("\n").length : 1, text: `not valid JSON: ${message}` });
    return undefined;
  }
}

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
const say = (problems: Problem[]) => problems.map((item) => describeProblem(item, "chatbot"));

type Mapped = { sentence: Json; codes: string[] };

/**
 * The context of one item: maps its sentences' words and collects what is wrong, each with its line.
 * `first` limits the words to the first ones of the teaching order (plus the no_card words).
 */
class Item {
  readonly errors: string[] = [];
  readonly notes: string[] = [];
  readonly codes = new Set<string>();
  private lines: { text: string; value: unknown }[] = [];

  constructor(
    private readonly built: BuiltItems,
    private readonly analyzer: Analyzer,
    readonly file: JsonFile,
    readonly level: string,
    private readonly first: Set<PackWord> | null,
    private readonly firstWhy = "",
  ) {}

  /** An error about a value of the file (its line is found from the value). */
  fail(text: string, value?: unknown) {
    this.lines.push({ text, value });
    this.errors.push(text);
  }

  /** Maps one sentence: `{text, translation_fa, …}` gets its tokens; the text loses its {code} marks. */
  sentence(raw: unknown, at: string): Mapped | null {
    if (!isObject(raw) || typeof raw.text !== "string") {
      this.fail(`${at}: needs "text" and "translation_fa"`);
      return null;
    }
    const analysis = this.analyzer.analyze(raw.text, { level: this.level });
    for (const problem of analysis.errors) this.fail(`${at}: ${problem}`, raw.text);
    for (const note of analysis.notes) this.note(`${at}: ${note}`, raw.text);
    if (analysis.gaps.length > 0) this.fail(`${at}: a [gap] has no place here; write the whole sentence`, raw.text);
    if (this.first) {
      for (const token of analysis.tokens) {
        if (token.word && !token.word.word.no_card && !this.first.has(token.word)) {
          this.fail(`${at}: «${token.surface}» (${token.word.word.code}, ${token.word.level} #${token.word.order}) is not among ${this.firstWhy}`, raw.text);
        }
      }
    }
    if (analysis.errors.length > 0) return null;
    this.built.exceptions.push(...formExceptions(analysis.tokens, (code) => this.analyzer.word(code)?.word.lemma));
    const tokens: Token[] = analysis.tokens.map(({ surface, kind, code, meaning_fa }) => ({ surface, kind, code, meaning_fa }));
    const codes = tokens.map((token) => token.code).filter((code): code is string => code !== null);
    for (const code of codes) this.codes.add(code);
    const { tokens: _ignored, ...rest } = raw;
    void _ignored;
    return { sentence: { tts_text: null, ...rest, text: analysis.text, tokens }, codes };
  }

  note(text: string, value?: unknown) {
    this.built.notes.push({ file: this.file.file, line: lineOf(this.file.text, value), text });
  }

  /** Problems from the importers' schemas and rules. */
  problems(problems: Problem[], value?: unknown) {
    for (const text of say(problems)) this.fail(text, value);
  }

  /** Writes the errors into the build; true when there was none. */
  close(label: string) {
    for (const { text, value } of this.lines) this.built.errors.push({ file: this.file.file, line: lineOf(this.file.text, value), text: `${label}: ${text}` });
    return this.errors.length === 0;
  }
}

/** The tier of the n-th A1 text (0-based), or null once the first texts are done (PRD §7.5). */
function tierOf(tiers: Tier[], index: number) {
  let end = 0;
  for (const tier of tiers) {
    end += tier.texts;
    if (index < end) return tier;
  }
  return null;
}

export type ItemSources = { texts: JsonFile[]; dialogues: JsonFile[]; errorfix: JsonFile[]; writing: JsonFile[] };

/**
 * Builds the items of one level. `units` are the grammar units of the pack by code with their level
 * (a find-the-mistake text names the units it practises); `cardWords` are the language's card words.
 */
export function buildItems(analyzer: Analyzer, sources: ItemSources, level: string, settings: ItemSettings, units: Map<string, string>, cardWords: PackWord[]): BuiltItems {
  const built: BuiltItems = { texts: [], dialogues: [], errorfix: [], writing: [], errors: [], notes: [], exceptions: [] };
  // `cardWords` come in teaching order, lower levels first.
  const firstOf = (n: number) => new Set(cardWords.slice(0, n));

  // Texts: one per file, in file order; the first A1 texts follow the tiers of prompt.first_texts.
  sources.texts.forEach((file, index) => {
    const value = parseJson(file, built.errors);
    if (value === undefined) return;
    if (!isObject(value)) {
      built.errors.push({ file: file.file, line: 1, text: "a text file holds one JSON object (one text)" });
      return;
    }
    const tier = level === "A1" ? tierOf(settings.firstTexts, index) : null;
    const item = new Item(built, analyzer, file, level, tier ? firstOf(tier.words) : null, tier ? `the first ${tier.words} words: text ${index + 1} of A1 is one of the first texts (PRD §7.5)` : "");
    const code = typeof value.code === "string" ? value.code.trim() : "";
    const band = Number(value.band);
    if (value.level !== undefined && value.level !== level) item.fail(`level ${String(value.level)}, but the file is in ${level}`, value.level);
    const sentences = asList(value.sentences).map((raw, k) => item.sentence(raw, `sentences[${k}]`));
    const record: Json = { ...value, level, placement_ok: value.placement_ok ?? false, sentences: sentences.map((mapped, k) => mapped?.sentence ?? asList(value.sentences)[k]) };
    const parsed = textRecord.safeParse(record);
    if (!parsed.success) item.problems(zodProblems(parsed.error));
    const ready: { text: string; tokens: { kind: string }[] }[] = [];
    for (const [k, mapped] of sentences.entries()) {
      if (!mapped) continue;
      const checked = textSentence.safeParse(mapped.sentence);
      if (!checked.success) item.problems(zodProblems(checked.error, `sentences[${k}]`), mapped.sentence.text);
      else ready.push(checked.data as { text: string; tokens: { kind: string }[] });
    }
    if (parsed.success) {
      const text = parsed.data;
      if (!(settings.levelBands[level] ?? []).includes(band)) item.fail(`band ${band} is not a band of ${level} (${(settings.levelBands[level] ?? []).join(", ")})`, value.band);
      const kind = (settings.textKinds[String(band)] ?? []).find((entry) => entry.kind === text.kind);
      if (!kind) item.fail(`kind «${text.kind}» is not a kind of band ${band} (${(settings.textKinds[String(band)] ?? []).map((entry) => entry.kind).join(", ")})`, text.kind);
      if (tier?.kind && text.kind !== tier.kind) item.fail(`the first A1 texts are of kind «${tier.kind}»`, text.kind);
      if (tier && text.placement_ok) item.fail("the first A1 texts are not placement texts: placement_ok false");
      const speakers = sentences.map((mapped) => mapped?.sentence.speaker ?? null);
      if (kind?.speakers && (speakers.some((speaker) => !speaker) || new Set(speakers).size < 2)) item.fail("a conversation: every sentence has a speaker, and there are at least two");
      if (kind && !kind.speakers && speakers.some((speaker) => speaker)) item.fail("this kind has no speakers: leave speaker out");
      const length = tier?.length ?? settings.textBands[String(band)] ?? [30, 60];
      const words = ready.reduce((sum, sentence) => sum + wordCount(sentence.text), 0);
      if (ready.length === text.sentences.length && (words < length[0] || words > length[1])) item.fail(`${words} words; band ${band}${tier ? " (first texts)" : ""} wants ${length[0]} to ${length[1]}`);
      if (ready.length === text.sentences.length) {
        const checked = checkQuestionSets(text.question_sets, { band, placement: text.placement_ok, sentences: ready as never });
        item.problems(checked.problems);
      }
      for (const word of text.key_words) if (!item.codes.has(word)) item.fail(`key word «${word}» is not a word of this text`, word);
      if (item.close(code || file.file)) {
        built.texts.push({ file: file.file, code: text.code, level, band, length, tierWords: tier?.words ?? null, placement_ok: text.placement_ok, kind: text.kind, record, codes: [...item.codes] });
      }
      return;
    }
    item.close(code || file.file);
  });
  const placement = built.texts.filter((text) => text.placement_ok).length;
  if (built.texts.length > 0 && placement !== settings.placementTexts) {
    built.notes.push({ file: sources.texts[0].file, line: 1, text: `${level} has ${placement} placement texts (placement_ok); the placement test uses ${settings.placementTexts} per level` });
  }

  // Dialogues: one per file. A1 uses the first 200 words of the teaching order (PRD §14.9).
  for (const file of sources.dialogues) {
    const value = parseJson(file, built.errors);
    if (value === undefined) continue;
    if (!isObject(value)) {
      built.errors.push({ file: file.file, line: 1, text: "a dialogue file holds one JSON object (one dialogue)" });
      continue;
    }
    const first = level === "A1" ? firstOf(DIALOGUE_A1_WORDS) : null;
    const item = new Item(built, analyzer, file, level, first, `the first ${DIALOGUE_A1_WORDS} words (an A1 dialogue uses only them)`);
    const code = typeof value.code === "string" ? value.code.trim() : file.file;
    if (value.level !== undefined && value.level !== level) item.fail(`level ${String(value.level)}, but the file is in ${level}`, value.level);
    const turns = asList(value.turns).map((raw, k) => {
      if (!isObject(raw)) {
        item.fail(`turns[${k}]: needs line, choices, correct and why_fa`);
        return raw;
      }
      const line = item.sentence(raw.line, `turns[${k}].line`);
      const choices = asList(raw.choices).map((choice, c) => item.sentence(choice, `turns[${k}].choices[${c}]`)?.sentence ?? choice);
      const turn = { ...raw, line: line?.sentence ?? raw.line, choices };
      const checked = dialogueTurn.safeParse(turn);
      if (!checked.success) item.problems(zodProblems(checked.error, `turns[${k}]`));
      else {
        if (checked.data.choices.length !== DIALOGUE_CHOICES) item.fail(`turns[${k}]: exactly ${DIALOGUE_CHOICES} choices`);
        else if (new Set(checked.data.choices.map((choice) => fold(choice.text))).size !== DIALOGUE_CHOICES) item.fail(`turns[${k}]: the choices must differ`);
        if (!Number.isInteger(checked.data.correct) || checked.data.correct < 0 || checked.data.correct >= checked.data.choices.length) item.fail(`turns[${k}]: correct is the index of the right choice (0 to 2)`);
      }
      return turn;
    });
    const record: Json = { ...value, level, turns };
    const parsed = dialogueRecord.safeParse(record);
    if (!parsed.success) item.problems(zodProblems(parsed.error, "dialogue"));
    if (turns.length < DIALOGUE_TURNS[0] || turns.length > DIALOGUE_TURNS[1]) item.fail(`${turns.length} turns; a dialogue has ${DIALOGUE_TURNS[0]} to ${DIALOGUE_TURNS[1]}`);
    if (item.close(code) && parsed.success) {
      built.dialogues.push({ file: file.file, code: parsed.data.code, level, situation: parsed.data.situation_fa, record, codes: [...item.codes] });
    }
  }

  // Find-the-mistake texts: a list per file. The corrected text is mapped; the units must be of this level or lower.
  for (const file of sources.errorfix) {
    const value = parseJson(file, built.errors);
    if (value === undefined) continue;
    for (const [k, raw] of asList(value).entries()) {
      const item = new Item(built, analyzer, file, level, null);
      if (!isObject(raw) || typeof raw.marked_text !== "string") {
        item.fail(`[${k}]: needs marked_text, translation_fa, unit_codes and errors`);
        item.close(`item ${k + 1}`);
        continue;
      }
      const corrected = correctedText(raw.marked_text);
      item.problems(checkMarks(raw.marked_text, asList(raw.errors).length), raw.marked_text);
      const mapped = item.sentence({ text: corrected, translation_fa: raw.translation_fa }, "the corrected text");
      const unitCodes = asList(raw.unit_codes).map(String);
      for (const unit of unitCodes) {
        const unitLevel = units.get(unit);
        if (!unitLevel) item.fail(`unit «${unit}» is not a unit of the pack`, unit);
        else if (levelRank(unitLevel) > levelRank(level)) item.fail(`unit «${unit}» is of ${unitLevel}, above ${level}`, unit);
      }
      const record: Json = { ...raw, level, tokens: (mapped?.sentence.tokens as Token[] | undefined) ?? [] };
      const parsed = errorfixRecord.safeParse(record);
      if (!parsed.success) item.problems(zodProblems(parsed.error), raw.marked_text);
      const key = fold(corrected).replace(/\s+/g, " ").trim();
      if (built.errorfix.some((other) => other.key === key)) item.fail("the same text is already in this level", raw.marked_text);
      if (item.close(corrected.slice(0, 40)) && mapped && parsed.success) built.errorfix.push({ file: file.file, key, level, record, codes: mapped.codes, units: unitCodes });
    }
  }

  // Writing tasks: a list per file, for the levels with a word range (prompt.writing_words: B1, B2).
  for (const file of sources.writing) {
    const value = parseJson(file, built.errors);
    if (value === undefined) continue;
    const range = settings.writingWords[level];
    for (const [k, raw] of asList(value).entries()) {
      const item = new Item(built, analyzer, file, level, null);
      const label = isObject(raw) && typeof raw.prompt_fa === "string" ? raw.prompt_fa : `item ${k + 1}`;
      if (!range) item.fail(`writing tasks are for the levels with a word range in prompt.writing_words (${Object.keys(settings.writingWords).join(", ")})`);
      const record: Json = { ...(isObject(raw) ? raw : {}), level };
      const parsed = writingRecord.safeParse(record);
      if (!parsed.success) item.problems(zodProblems(parsed.error), label);
      else if (range) item.problems(checkWriting(parsed.data, range), label);
      const key = label.replace(/\s+/g, " ").trim();
      if (built.writing.some((other) => other.key === key)) item.fail("the same prompt_fa is already in this level", label);
      if (item.close(label.slice(0, 40)) && parsed.success) built.writing.push({ file: file.file, key, level, record });
    }
  }
  return built;
}

/** The phonics lessons of a language (all open with A1), one per file, in file order. */
export function buildPhonics(files: JsonFile[], settings: ItemSettings): { lessons: PackPhonics[]; errors: Note[]; notes: Note[] } {
  const out = { lessons: [] as PackPhonics[], errors: [] as Note[], notes: [] as Note[] };
  files.forEach((file, index) => {
    const value = parseJson(file, out.errors);
    if (value === undefined) return;
    const fail = (text: string, at?: unknown) => out.errors.push({ file: file.file, line: lineOf(file.text, at), text });
    const parsed = phonicsLessonRecord.safeParse(value);
    if (!parsed.success) {
      for (const text of say(zodProblems(parsed.error))) fail(text);
      return;
    }
    const lesson = parsed.data;
    const problems = checkLesson(lesson, lesson.kind);
    for (const text of say(problems)) fail(text);
    if (out.lessons.some((other) => samePhonics(other.label, lesson.sound_label))) fail(`another lesson is also «${lesson.sound_label}»`, lesson.sound_label);
    if (!settings.phonicsLessons.some((planned) => samePhonics(planned.label, lesson.sound_label))) {
      out.notes.push({ file: file.file, line: lineOf(file.text, lesson.sound_label), text: `«${lesson.sound_label}» is not in the teacher's list (phonics.lessons); the panel will still plan that list's lessons` });
    }
    if (problems.length === 0) out.lessons.push({ file: file.file, label: lesson.sound_label, kind: lesson.kind, order_no: index + 1, record: value as Json });
  });
  return out;
}
