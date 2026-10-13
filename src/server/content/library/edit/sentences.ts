import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { t } from "@/i18n";
import { filled, optionalText } from "@/schemas/common";
import { db } from "@/server/db";
import type { Tx } from "../../kinds/types";
import { wordCount } from "../../kinds/targets";
import { checkTarget, sentenceHash, type TargetInput } from "../../kinds/sentence-store";
import { levelRank } from "../../languages";
import { problem, type Problem } from "../../problems";
import { refreshDifficulty } from "../../text-difficulty";
import { loadVocabulary } from "../../vocabulary";
import { logChange, plain, same } from "../log";
import { sentenceUses } from "../status";
import { errorsOf, logEdit, parseValues, staleAudio, textOrNull, type WordInfo } from "./shared";
import { mapForEdit, tokenEdit, tokensForEdit, tokenWords, type TokenEdit } from "./tokens";
import { viewOf, type Editor } from "./types";

const targetEdit = z.object({
  id: z.number().int(),
  marked_text: z.string(),
  /** Per blank: one list for a one-blank target, two lists for two blanks. */
  accepted: z.array(z.array(z.string())),
  distractors: z.array(z.array(z.string())),
  hint: optionalText,
  accepted_full: z.array(z.string()),
  retire: z.boolean(),
});
const schema = z.object({
  text: filled,
  tts_text: optionalText,
  translation_fa: filled,
  tokens: z.array(tokenEdit),
  targets: z.array(targetEdit),
});
export type SentenceValues = z.output<typeof schema>;
export type TargetEdit = z.output<typeof targetEdit>;
export type TargetInfo = { id: number; type: "word" | "grammar"; name: string; nameVoice: "target" | "fa"; href: string | null; blanks: number; status: string };
export type UseRef = { id: number; title: string; voice: "target" | "fa"; type: "texts" | "dialogues" | "units" };
export type SentenceContext = {
  level: string | null;
  words: Record<string, WordInfo>;
  targets: TargetInfo[];
  uses: UseRef[];
};

type StoredTarget = { id: number; marked_text: string; blanks: number; accepted: unknown; distractors: unknown; hint: string | null; accepted_full: unknown; status: string };

const perBlank = (value: unknown, blanks: number): string[][] => {
  const list = (value ?? []) as (string | string[])[];
  return blanks === 1 ? [list.map(String)] : Array.from({ length: blanks }, (_, index) => ((list[index] ?? []) as string[]).map(String));
};
const clean = (list: string[]) => list.map((item) => item.trim()).filter(Boolean);
export const targetColumns = (target: StoredTarget) => ({
  id: target.id,
  marked_text: target.marked_text,
  accepted: target.accepted,
  distractors: target.distractors,
  hint: target.hint,
  accepted_full: target.accepted_full ?? null,
  status: target.status,
});
export const wordColumns = (row: Record<string, unknown>) => ({
  position: row.position,
  kind: row.kind,
  word_id: row.word_id,
  surface: row.surface,
  spans: row.spans,
  meaning_fa_ctx: row.meaning_fa_ctx,
  suspect: row.suspect,
  code_given: row.code_given,
  candidate_reason: row.candidate_reason,
});

/**
 * What a changed sentence does to its audio and its texts (PRD §13.7, §13.8): a new text makes both
 * files stale; a new spoken form only the machine one. Texts made of the sentence get their word
 * count again and their files go stale; until a new file comes the phone's voice reads them, so a
 * published text stays live (DECISIONS.md: phone voice). Returns the notes the teacher sees. Also
 * used when «برگردان» puts an old text back.
 */
export async function afterSentenceChange(
  tx: Tx,
  adminId: number | null,
  sentence: { id: number; language: string; audio_id: number | null; human_audio_id: number | null },
  change: { textChanged: boolean; ttsChanged: boolean },
) {
  const notes: string[] = [];
  if (change.textChanged) await staleAudio(tx, [sentence.audio_id, sentence.human_audio_id]);
  else if (change.ttsChanged) await staleAudio(tx, [sentence.audio_id]);
  if (!change.textChanged) return notes;
  const texts = await tx.text.findMany({ where: { language: sentence.language, sentence_ids: { has: sentence.id } } });
  for (const item of texts) {
    const lines = await tx.sentence.findMany({ where: { id: { in: item.sentence_ids } }, select: { text: true } });
    const after = { word_count: lines.reduce((sum, line) => sum + wordCount(line.text), 0) };
    const changed = Object.entries(after).filter(([key, value]) => !same(item[key as keyof typeof item], value));
    if (changed.length > 0) {
      await tx.text.update({ where: { id: item.id }, data: after });
      await logChange(tx, adminId, {
        action: "edit",
        entity: "text",
        entityId: item.id,
        before: Object.fromEntries(changed.map(([key]) => [key, item[key as keyof typeof item]])),
        after: Object.fromEntries(changed),
      });
    }
    if (await staleAudio(tx, [item.audio_id, item.human_audio_id])) notes.push(t("admin.library.form.textOfSentenceStale", { title: item.title }));
  }
  return notes;
}

/**
 * A sentence (PRD §13.7): its text, spoken form, translation, word table and fill-in targets. A new
 * text runs the mapping check again (PRD §14.1), may not equal another sentence (PRD §14.9), makes its
 * audio stale, and the audio of the texts it is in.
 */
export const sentenceEditor: Editor<SentenceValues, SentenceContext> = {
  async load(id) {
    const row = await db.sentence.findUnique({
      where: { id },
      include: { words: true, targets: { where: { status: { not: "retired" } }, orderBy: { id: "asc" } } },
    });
    if (!row) return null;
    const [vocabulary, uses] = await Promise.all([loadVocabulary(db, row.language), sentenceUses(db, row.language, [id])]);
    const tokens = tokensForEdit(row.words, vocabulary);
    const wordIds = row.targets.filter((target) => target.target_type === "word").map((target) => target.target_id);
    const unitIds = row.targets.filter((target) => target.target_type === "grammar").map((target) => target.target_id);
    const [words, units] = await Promise.all([
      db.word.findMany({ where: { id: { in: wordIds } }, select: { id: true, lemma: true } }),
      db.grammarUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, title_fa: true } }),
    ]);
    const use = uses.get(id) ?? { texts: [], dialogues: [], units: [] };
    const [useTexts, useDialogues, useUnits] = await Promise.all([
      db.text.findMany({ where: { id: { in: use.texts } }, select: { id: true, title: true } }),
      db.dialogue.findMany({ where: { id: { in: use.dialogues } }, select: { id: true, title_fa: true } }),
      db.grammarUnit.findMany({ where: { id: { in: use.units } }, select: { id: true, title_fa: true } }),
    ]);
    return {
      language: row.language,
      view: viewOf(row, row.text, "target", row.level),
      values: {
        text: row.text,
        tts_text: row.tts_text,
        translation_fa: row.translation_fa,
        tokens,
        targets: row.targets.map((target) => ({
          id: target.id,
          marked_text: target.marked_text,
          accepted: perBlank(target.accepted, target.blanks),
          distractors: perBlank(target.distractors, target.blanks),
          hint: target.hint,
          accepted_full: ((target.accepted_full ?? []) as string[]).map(String),
          retire: false,
        })),
      },
      context: {
        level: row.level,
        words: await tokenWords(row.language, tokens),
        targets: row.targets.map((target) => {
          const isWord = target.target_type === "word";
          const name = isWord ? words.find((word) => word.id === target.target_id)?.lemma : units.find((unit) => unit.id === target.target_id)?.title_fa;
          return {
            id: target.id,
            type: target.target_type,
            name: name ?? "—",
            nameVoice: isWord ? "target" : "fa",
            href: name ? `/admin/content/${isWord ? "words" : "units"}/${target.target_id}` : null,
            blanks: target.blanks,
            status: target.status,
          };
        }),
        uses: [
          ...useTexts.map((item) => ({ id: item.id, title: item.title, voice: "target" as const, type: "texts" as const })),
          ...useDialogues.map((item) => ({ id: item.id, title: item.title_fa, voice: "fa" as const, type: "dialogues" as const })),
          ...useUnits.map((item) => ({ id: item.id, title: item.title_fa, voice: "fa" as const, type: "units" as const })),
        ],
      },
    };
  },

  async save(id, raw, adminId) {
    const parsed = parseValues(schema, raw);
    if (!parsed.ok) return { state: "invalid", errors: parsed.errors };
    const values = parsed.values;
    return db.$transaction(async (tx) => {
      const row = await tx.sentence.findUnique({
        where: { id },
        include: { words: { orderBy: { position: "asc" } }, targets: { where: { status: { not: "retired" } }, orderBy: { id: "asc" } } },
      });
      if (!row) return { state: "gone" as const };
      const language = row.language;
      const text = values.text.trim();
      const textChanged = text !== row.text;
      const problems: Problem[] = [];

      const hash = sentenceHash(text);
      if (hash !== row.text_hash) {
        const twin = await tx.sentence.findUnique({ where: { language_text_hash: { language, text_hash: hash } }, select: { id: true } });
        if (twin && twin.id !== id) problems.push(problem("sameItemExists", { field: "text" }));
      }

      // Targets: the same blank rules as import, on the new text (PRD §13.3).
      const stored = new Map(row.targets.map((target) => [target.id, target]));
      const targetData: { id: number; data: Record<string, unknown> }[] = [];
      values.targets.forEach((edit, index) => {
        const old = stored.get(edit.id);
        if (!old) return;
        if (edit.retire) {
          targetData.push({ id: old.id, data: { status: "retired" } });
          return;
        }
        const accepted = edit.accepted.slice(0, old.blanks).map(clean);
        const distractors = edit.distractors.slice(0, old.blanks).map(clean);
        const input: TargetInput = {
          marked_text: edit.marked_text.trim(),
          blanks: old.blanks as 1 | 2,
          accepted: old.blanks === 1 ? (accepted[0] ?? []) : accepted,
          distractors: old.blanks === 1 ? (distractors[0] ?? []) : distractors,
          hint: textOrNull(edit.hint),
          accepted_full: clean(edit.accepted_full).length > 0 ? clean(edit.accepted_full) : null,
        };
        problems.push(...checkTarget(input, text, `targets[${index}]`));
        targetData.push({ id: old.id, data: { marked_text: input.marked_text, accepted: input.accepted, distractors: input.distractors, hint: input.hint, accepted_full: input.accepted_full } });
      });

      const vocabulary = await loadVocabulary(tx, language);
      const mapped = mapForEdit(text, values.tokens, vocabulary);
      const errors = [...errorsOf(problems), ...("errors" in mapped ? mapped.errors : [])];
      if (errors.length > 0 || !("rows" in mapped)) return { state: "invalid" as const, errors };

      const levels = mapped.rows.map((item) => (item.word_id ? vocabulary.byId(item.word_id)?.level : null)).filter((level): level is string => Boolean(level));
      const level = levels.reduce<string | null>((top, value) => (top && levelRank(top) >= levelRank(value) ? top : value), null);
      const data = { text, tts_text: textOrNull(values.tts_text), translation_fa: values.translation_fa, text_hash: hash, level };

      const oldWords = row.words.map(wordColumns);
      const newWords = mapped.rows.map((item) => wordColumns(item));
      const wordsChanged = !same(oldWords, newWords);
      const changedTargets = targetData.filter(({ id: targetId, data: next }) => {
        const old = targetColumns(stored.get(targetId)!);
        return Object.entries(next).some(([key, value]) => !same(old[key as keyof typeof old], value));
      });
      const extra =
        wordsChanged || changedTargets.length > 0
          ? {
              before: {
                ...(wordsChanged ? { sentence_word: plain(oldWords) } : {}),
                ...(changedTargets.length > 0 ? { sentence_target: changedTargets.map(({ id: targetId }) => targetColumns(stored.get(targetId)!)) } : {}),
              },
              after: {
                ...(wordsChanged ? { sentence_word: plain(newWords) } : {}),
                ...(changedTargets.length > 0
                  ? { sentence_target: changedTargets.map(({ id: targetId, data: next }) => ({ ...targetColumns(stored.get(targetId)!), ...next })) }
                  : {}),
              },
            }
          : undefined;

      if (!(await logEdit(tx, adminId, "sentences", id, row, data, extra))) return { state: "saved" as const, values, notes: [] };
      await tx.sentence.update({ where: { id }, data });
      if (wordsChanged) {
        await tx.sentenceWord.deleteMany({ where: { sentence_id: id } });
        await tx.sentenceWord.createMany({ data: mapped.rows.map((item) => ({ sentence_id: id, ...wordColumns(item) }) as Prisma.SentenceWordCreateManyInput) });
      }
      for (const { id: targetId, data: next } of changedTargets) {
        await tx.sentenceTarget.update({ where: { id: targetId }, data: next as Prisma.SentenceTargetUpdateInput });
      }

      const notes = await afterSentenceChange(tx, adminId, { ...row, language }, { textChanged, ttsChanged: data.tts_text !== row.tts_text });
      if (wordsChanged || textChanged) await refreshDifficulty(tx, { sentenceIds: [id] });

      const finalTargets = values.targets
        .filter((edit) => !edit.retire)
        .map((edit) => {
          const next = targetData.find((item) => item.id === edit.id)?.data;
          const old = stored.get(edit.id)!;
          return next
            ? { ...edit, marked_text: next.marked_text as string, accepted: perBlank(next.accepted, old.blanks), distractors: perBlank(next.distractors, old.blanks), hint: next.hint as string | null, accepted_full: ((next.accepted_full ?? []) as string[]) }
            : edit;
        });
      return {
        state: "saved" as const,
        values: { ...values, text, tts_text: data.tts_text, tokens: tokensForEdit(mapped.rows, vocabulary) as TokenEdit[], targets: finalTargets },
        notes,
      };
    });
  },
};
