import { Prisma } from "@/generated/prisma/client";
import { t } from "@/i18n";
import { textRecord, textSentence, type TextSentence } from "@/schemas/texts";
import { db } from "@/server/db";
import type { LevelTargets } from "@/server/settings/app-catalog";
import { appSetting } from "@/server/settings/read";
import { levelRank, type LanguageCode } from "../languages";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound, type ImportReport } from "../report";
import { allowedTypes, checkQuestionSets, questionRange, tracks } from "../text-check";
import { loadVocabulary } from "../vocabulary";
import { allowedWords } from "./allowed";
import { mapSentence, storeSentence } from "./sentence-store";
import { example, labelOf, languageValues, lines, params, trace } from "./shared";
import type { ContentKind } from "./types";

type Range = [number, number];
type TextKindEntry = { kind: string; name_fa: string; speakers: boolean };
/** One tier of the first A1 texts (PRD §7.5): how many texts use how many first words. */
type Tier = { texts: number; words: number; length?: Range; kind?: string };

/** One text a batch asks for; the chatbot writes it under this code. */
export type TextSpec = { code: string; level: string; band: number; kind: string; topic: string; placement_ok: boolean };
type TextParams = { level: string; band: number; length: Range; words: number | null; texts: TextSpec[] };

const editable = new Set(["draft", "needs_review"]);
const openStates = ["prompt_made", "pasted"] as const;

async function textSettings(language: string) {
  const [levels, targets, bands, perBatch, levelBands, kinds, topics, tiers, placement] = await Promise.all([
    appSetting<string[]>(`levels.${language}`),
    appSetting<Record<string, LevelTargets>>(`targets.${language}`),
    appSetting<Record<string, Range>>("prompt.text_bands"),
    appSetting<Record<string, number>>("prompt.texts_per_batch"),
    appSetting<Record<string, number[]>>("prompt.text_level_bands"),
    appSetting<Record<string, TextKindEntry[]>>("prompt.text_kinds"),
    appSetting<string[]>("prompt.text_topics"),
    appSetting<Tier[]>("prompt.first_texts"),
    appSetting<number>("prompt.placement_texts"),
  ]);
  return { levels, targets, bands, perBatch, levelBands, kinds, topics, tiers, placement };
}

/** Texts already made and texts an open batch is making: what the next batch counts against. */
async function textsSoFar(language: string) {
  const [made, open] = await Promise.all([
    db.text.findMany({ where: { language, status: { not: "retired" } }, select: { code: true, level: true, band: true, kind: true, placement_ok: true } }),
    db.importBatch.findMany({ where: { language, prompt_kind: "P_T", state: { in: [...openStates] } }, select: { params: true } }),
  ]);
  const planned = open.flatMap((batch) => (batch.params as Partial<TextParams> | null)?.texts ?? []);
  const codes = new Set([...made, ...planned].map((text) => text.code));
  // A planned text that is already in (a batch pasted twice) counts once.
  return { all: [...made, ...planned.filter((text) => !made.some((row) => row.code === text.code))], codes };
}

/** The tier of the n-th A1 text (0-based), or null once the first texts are done. */
function tierOf(tiers: Tier[], index: number) {
  let end = 0;
  for (const tier of tiers) {
    end += tier.texts;
    if (index < end) return { ...tier, end };
  }
  return null;
}

/** Card words that already have their meaning, at the level or below: what a text can be made of. */
async function readyWords(language: string, level: string) {
  const words = await db.word.findMany({
    where: { language, meaning_fa: { not: null }, no_card: false, register: "standard", dup_of_id: null, status: { not: "retired" } },
    select: { level: true },
  });
  return { upTo: words.filter((word) => levelRank(word.level) <= levelRank(level)).length, at: words.filter((word) => word.level === level).length };
}

export type TextsNext =
  | { state: "ready"; level: string; band: number; size: number; left: number; goal: number }
  | { state: "needsUnits"; level: string }
  | { state: "needsWords"; level: string; count: number }
  | { state: "done" };

/**
 * The next P-T batch (PRD §7.5, §7.8, §14.9): the lowest level short of its text target, one band, and
 * as many texts as the band allows. Levels go in order; a level waits for its grammar units and words.
 */
async function planTexts(language: string, wanted?: string) {
  const settings = await textSettings(language);
  const { all, codes } = await textsSoFar(language);
  const count = (level: string, band?: number) => all.filter((text) => text.level === level && (band === undefined || text.band === band)).length;
  const levels = settings.levels.filter((level) => count(level) < (settings.targets[level]?.texts ?? 0));
  const level = wanted && levels.includes(wanted) ? wanted : levels[0];
  if (!level) return { next: { state: "done" } as TextsNext };

  const have = count(level);
  const goal = settings.targets[level].texts;
  const units = await db.grammarUnit.count({ where: { language, level, status: { not: "retired" } } });
  if (units === 0) return { next: { state: "needsUnits", level } as TextsNext };

  // The first A1 texts are made of the first words of the teaching order only (PRD §7.5).
  const tier = level === "A1" ? tierOf(settings.tiers, have) : null;
  const words = await readyWords(language, level);
  const needed = tier ? tier.words : 1;
  if ((tier ? words.upTo : words.at) < needed) return { next: { state: "needsWords", level, count: needed } as TextsNext };

  // A2 has two bands: the one with fewer texts goes next.
  const bandChoices = settings.levelBands[level] ?? [1];
  const band = bandChoices.reduce((best, choice) => (count(level, choice) < count(level, best) ? choice : best), bandChoices[0]);
  const size = Math.max(1, Math.min(settings.perBatch[String(band)] ?? 1, goal - have, tier ? tier.end - have : Infinity));
  const next: TextsNext = { state: "ready", level, band, size, left: goal - have, goal };
  return { next, settings, all, codes, tier, have };
}

/** Status for the workbench and the create page. */
export async function nextTexts(language: string): Promise<TextsNext> {
  return (await planTexts(language)).next;
}

const wordCount = (sentences: { text: string }[]) =>
  sentences.reduce((sum, sentence) => sum + sentence.text.split(/\s+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length, 0);

/** The question rules for the prompt, in the words the chatbot reads. */
function questionRules(band: number, placement: boolean) {
  const [min, max] = questionRange(band, "B", false);
  const sets = `هر مجموعه بین ${min} و ${max} سؤال.`;
  return placement ? `${sets} در متنی که placement_ok آن true است، مجموعه A هر مسیر دست‌کم ${questionRange(band, "A", true)[0]} سؤال دارد.` : sets;
}

/**
 * P-T (PRD §14.6): one to three texts with their sentences, word mapping, key words and four question
 * sets. The panel picks level, band, kind, topic and code of each text; the chatbot writes them.
 */
export const texts: ContentKind = {
  kind: "P_T",
  template: "P-T.md",
  rootKey: "texts",

  async plan(language, options) {
    const planned = await planTexts(language, options.level);
    const { next } = planned;
    if (next.state === "done") return { nothing: t("admin.create.nothing.texts") };
    if (next.state === "needsUnits") return { nothing: t("admin.create.kinds.texts.needsUnits", { level: next.level }) };
    if (next.state === "needsWords") return { nothing: t("admin.create.kinds.texts.needsWords", { level: next.level, count: next.count }) };
    const { settings, all, codes, tier, have } = planned as Required<typeof planned>;
    const { level, band, size } = next;

    const kinds = (settings.kinds[String(band)] ?? []).filter((entry) => !tier?.kind || entry.kind === tier.kind);
    const placements = all.filter((text) => text.level === level && text.placement_ok).length;
    const specs: TextSpec[] = [];
    let number = have;
    for (let k = 0; k < size; k++) {
      const used = (kind: string) => [...all, ...specs].filter((text) => text.level === level && text.band === band && text.kind === kind).length;
      const kind = kinds.reduce((best, entry) => (used(entry.kind) < used(best.kind) ? entry : best), kinds[0]);
      let code = "";
      do code = `${language}-${level.toLowerCase()}-t${String(++number).padStart(3, "0")}`;
      while (codes.has(code));
      specs.push({
        code,
        level,
        band,
        kind: kind?.kind ?? "dialogue",
        topic: settings.topics[(have + k) % Math.max(1, settings.topics.length)] ?? "",
        placement_ok: !tier && placements + specs.filter((spec) => spec.placement_ok).length < settings.placement,
      });
    }

    const length = tier?.length ?? settings.bands[String(band)] ?? [30, 60];
    const nameOf = (kind: string) => kinds.find((entry) => entry.kind === kind);
    const units = await db.grammarUnit.findMany({
      where: { language, status: { not: "retired" } },
      select: { unit_code: true, title_fa: true, level: true, order_no: true },
    });
    const unitLines = units
      .filter((unit) => levelRank(unit.level) <= levelRank(level))
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.order_no ?? 1e9) - (b.order_no ?? 1e9))
      .map((unit) => [unit.unit_code, unit.title_fa, unit.level].join(" | "));
    const typeList = (track: (typeof tracks)[number]) => allowedTypes(track, band).join("، ");

    return {
      params: { level, band, length, words: tier?.words ?? null, texts: specs } satisfies TextParams,
      values: {
        ...languageValues(language),
        level,
        band: String(band),
        count: String(specs.length),
        length: `${length[0]} تا ${length[1]}`,
        texts: specs
          .map((spec) => {
            const kind = nameOf(spec.kind);
            const speakers = kind?.speakers ? "گفتگو" : "بدون گوینده";
            return [spec.code, spec.kind, `${kind?.name_fa ?? spec.kind} (${speakers})`, spec.topic, String(spec.placement_ok)].join(" | ");
          })
          .join("\n"),
        allowed: await allowedWords(language, tier ? { first: tier.words } : { level }),
        units: lines(unitLines),
        counts: questionRules(band, specs.some((spec) => spec.placement_ok)),
        reading: typeList("reading"),
        listening: typeList("listening"),
        question_language:
          band <= 2
            ? "پرسش، گزینه‌ها و موردهای سؤال‌ها را به فارسی بنویس."
            : `پرسش، گزینه‌ها و موردهای سؤال‌ها را به ${languageValues(language).language} بنویس و ترجمه فارسی پرسش را در prompt_fa بیاور.`,
        example: example("P-T", language as LanguageCode),
      },
      summary: [
        t("admin.create.summary.texts", {
          count: specs.length,
          level,
          band,
          list: specs.map((spec) => t("admin.create.summary.textLine", { kind: nameOf(spec.kind)?.name_fa ?? spec.kind, topic: spec.topic })).join("، "),
        }),
        specs.map((spec) => spec.code).join(" · "),
      ],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const { texts: specs, length } = params<TextParams>(batch);
    const kinds = await appSetting<Record<string, TextKindEntry[]>>("prompt.text_kinds");
    const vocabulary = await loadVocabulary(tx, batch.language);
    const seen = new Map<string, number>();
    const done = new Set<string>();

    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["code", "title"], index);
      const reject = (problems: Problem[]) => round.rejected.push({ label, record, problems });
      const parsed = textRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        reject(zodProblems(parsed.error));
        continue;
      }
      const text = parsed.data;
      const spec = specs.find((item) => item.code === text.code);
      if (!spec) {
        reject([problem("textNotPlanned", { code: text.code, codes: specs.map((item) => item.code).join("، ") })]);
        continue;
      }
      if (done.has(spec.code)) {
        reject([problem("repeatedInAnswer", { code: spec.code })]);
        continue;
      }

      const problems: Problem[] = [];
      if (text.level !== spec.level) problems.push(problem("levelMismatch", { value: text.level, level: spec.level }));
      if (text.band !== spec.band) problems.push(problem("badValue", { value: text.band, field: "band" }));
      if (text.kind !== spec.kind) problems.push(problem("badValue", { value: text.kind, field: "kind" }));

      // Each sentence: its shape, then its word mapping (PRD §13.3 "متن": the three sentence checks).
      const sentences: TextSentence[] = [];
      for (const [k, raw] of text.sentences.entries()) {
        const sentence = textSentence.safeParse(raw, { reportInput: true });
        if (sentence.success) sentences.push(sentence.data);
        else problems.push(...zodProblems(sentence.error, `sentences[${k}]`));
      }
      const mapped = sentences.map((sentence) => mapSentence(sentence, vocabulary));
      for (const item of mapped) problems.push(...item.problems);

      const kind = (kinds[String(spec.band)] ?? []).find((entry) => entry.kind === spec.kind);
      const speakers = sentences.map((sentence) => sentence.speaker);
      if (kind?.speakers && (speakers.some((speaker) => !speaker) || new Set(speakers).size < 2)) problems.push(problem("speakers"));

      const words = wordCount(sentences);
      if (sentences.length === text.sentences.length && (words < length[0] || words > length[1])) {
        problems.push(problem("textLength", { count: words, min: length[0], max: length[1] }));
      }

      const checked = checkQuestionSets(text.question_sets, { band: spec.band, placement: spec.placement_ok, sentences });
      problems.push(...checked.problems);

      const existing = await tx.text.findUnique({ where: { language_code: { language: batch.language, code: spec.code } } });
      if (existing && !editable.has(existing.status)) problems.push(problem("locked", { code: spec.code }));
      if (problems.length > 0) {
        reject(problems);
        continue;
      }

      const sentenceIds: number[] = [];
      for (const [k, sentence] of sentences.entries()) {
        const stored = await storeSentence(tx, batch, { sentence, rows: mapped[k].rows!, vocabulary, level: spec.level, label: spec.code }, round, seen);
        sentenceIds.push(stored.id);
      }

      // Key words must be words of the list that appear in this text (PRD §14.3); others are dropped.
      const inText = new Set(mapped.flatMap((item) => item.rows ?? []).map((row) => row.word_id).filter((id): id is number => id !== null));
      const keyWordIds: number[] = [];
      for (const code of text.key_words) {
        const word = vocabulary.byCode(code);
        if (word && inText.has(word.id)) {
          if (!keyWordIds.includes(word.id)) keyWordIds.push(word.id);
        } else {
          round.warnings.push({ label: spec.code, problem: problem("keyWordUnknown", { code }) });
        }
      }

      const data = {
        level: spec.level,
        band: spec.band,
        kind: spec.kind,
        title: text.title,
        sentence_ids: sentenceIds,
        speakers: kind?.speakers ? (speakers as Prisma.InputJsonValue) : Prisma.DbNull,
        word_count: words,
        key_word_ids: keyWordIds,
        placement_ok: spec.placement_ok,
        ...trace(batch),
      };
      const saved = existing
        ? await tx.text.update({ where: { id: existing.id }, data })
        : await tx.text.create({ data: { language: batch.language, code: spec.code, ...data } });
      // A draft text that comes again gets its new questions in place of the old ones.
      if (existing) await tx.question.deleteMany({ where: { text_id: saved.id } });
      await tx.question.createMany({
        data: checked.questions.map(({ track, set, order_no, question }) => {
          const { type, explanation_fa, prompt_fa, ...rest } = question;
          const payload = prompt_fa ? { ...rest, prompt_fa } : rest;
          return {
            language: batch.language,
            text_id: saved.id,
            track,
            set,
            order_no,
            type,
            payload: payload as Prisma.InputJsonValue,
            explanation_fa,
            ...trace(batch),
          };
        }),
      });
      if (existing) round.updated++;
      else round.added++;
      done.add(spec.code);
      round.accepted.push({ label: `${spec.code} · ${text.title}`, entity: { type: "text", id: saved.id }, record });
    }

    // A planned text the chatbot left out is offered again by the next batch; the report says so once.
    const returned = new Set(records.map((record) => String((record as { code?: unknown } | null)?.code ?? "").trim()));
    const warned = new Set(
      ((batch.report as ImportReport | null)?.warnings ?? []).filter((flag) => flag.problem.key === "notReturned").map((flag) => flag.label),
    );
    const made = await tx.text.findMany({ where: { language: batch.language, code: { in: specs.map((spec) => spec.code) } }, select: { code: true } });
    for (const spec of specs) {
      if (returned.has(spec.code) || warned.has(spec.code) || made.some((row) => row.code === spec.code)) continue;
      round.warnings.push({ label: spec.code, problem: problem("notReturned", { lemma: spec.code }) });
    }
    return round;
  },
};
