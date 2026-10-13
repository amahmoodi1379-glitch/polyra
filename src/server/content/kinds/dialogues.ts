import type { Prisma } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { t } from "@/i18n";
import { dialogueRecord, dialogueTurn } from "@/schemas/speaking";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { loadVocabulary } from "../vocabulary";
import { allowedWords } from "./allowed";
import { mapSentence, storeSentence, type SentenceInput } from "./sentence-store";
import { example, languageValues, lines, params, trace } from "./shared";
import { nextLevel, openStates, unitLines, type LevelNext } from "./targets";
import type { ContentKind } from "./types";

type DialogueParams = { level: string; code: string; situation: string };

const editable = new Set(["draft", "needs_review"]);
/** PRD §8b.4: 5 to 8 turns, three choices each. */
const TURNS: [number, number] = [5, 8];
const CHOICES = 3;
/** An A1 dialogue uses the first 200 words of the teaching order (PRD §14.9). */
const A1_WORDS = 200;

const same = (text: string) => fold(text).replace(/\s+/g, " ").trim();

async function dialogueCounts(language: string) {
  const [made, open] = await Promise.all([
    db.dialogue.findMany({ where: { language, status: { not: "retired" } }, select: { level: true, code: true } }),
    db.importBatch.findMany({ where: { language, prompt_kind: "P_D", state: { in: [...openStates] } }, select: { params: true } }),
  ]);
  const planned = open.map((batch) => batch.params as DialogueParams);
  const all = [...made, ...planned.filter((spec) => !made.some((row) => row.code === spec.code))];
  const counts = new Map<string, number>();
  for (const row of all) counts.set(row.level, (counts.get(row.level) ?? 0) + 1);
  return { counts, codes: new Set(all.map((row) => row.code)) };
}

/** The next situational dialogue to make (one per batch, PRD §14.9), or what it waits for. */
export async function nextDialogue(language: string, wanted?: string): Promise<LevelNext> {
  const { counts } = await dialogueCounts(language);
  return nextLevel(language, "dialogues", counts, { wanted, size: 1, firstWords: (level) => (level === "A1" ? A1_WORDS : null) });
}

/**
 * P-D (PRD §14.6, §8b.4): one situational dialogue. The panel picks the level, the situation (in turn
 * from the teacher's list in the general settings) and the code. Every line and every choice is stored
 * as a sentence with its word mapping, so each gets its audio like any other sentence.
 */
export const dialogues: ContentKind = {
  kind: "P_D",
  template: "P-D.md",
  rootKey: "dialogue",
  parts: [{ key: "dialogue", single: true }],
  matches: (batch, answer) => {
    const code = (answer.dialogue as { code?: unknown } | null | undefined)?.code;
    return code === undefined || code === null || (typeof code === "string" && code.trim() === params<DialogueParams>(batch).code);
  },

  async plan(language, options) {
    const next = await nextDialogue(language, options.level);
    if (next.state === "done") return { nothing: t("admin.create.nothing.dialogues") };
    if (next.state === "needsUnits") return { nothing: t("admin.create.kinds.dialogues.needsUnits", { level: next.level }) };
    if (next.state === "needsWords") return { nothing: t("admin.create.kinds.dialogues.needsWords", { level: next.level, count: next.count }) };
    const { level } = next;
    const { counts, codes } = await dialogueCounts(language);
    const situations = (await appSetting<Record<string, string[]>>("prompt.dialogue_situations"))[level] ?? [];
    const have = counts.get(level) ?? 0;
    const situation = situations.length > 0 ? situations[have % situations.length] : t("admin.create.kinds.dialogues.anySituation");
    let number = have;
    let code = "";
    do code = `${language}-${level.toLowerCase()}-d${String(++number).padStart(3, "0")}`;
    while (codes.has(code));
    const made = await db.dialogue.findMany({ where: { language, level, status: { not: "retired" } }, select: { title_fa: true } });

    return {
      params: { level, code, situation } satisfies DialogueParams,
      values: {
        ...languageValues(language),
        level,
        code,
        situation,
        allowed: await allowedWords(language, level === "A1" ? { first: A1_WORDS } : { level }),
        units: lines(await unitLines(language, level)),
        existing: lines(made.map((row) => row.title_fa)),
        example: example("P-D", language),
      },
      summary: [t("admin.create.summary.dialogues", { level, situation }), code],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const { level, code } = params<DialogueParams>(batch);
    const vocabulary = await loadVocabulary(tx, batch.language);
    const seen = new Map<string, number>();

    for (const record of records) {
      const label = code;
      const reject = (problems: Problem[]) => round.rejected.push({ label, record, problems, part: "dialogue" });
      const parsed = dialogueRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        reject(zodProblems(parsed.error, "dialogue"));
        continue;
      }
      const dialogue = parsed.data;
      const problems: Problem[] = [];
      if (dialogue.level !== level) problems.push(problem("levelMismatch", { value: dialogue.level, level }));
      if (dialogue.turns.length < TURNS[0]) problems.push(problem("tooFew", { field: "turns", min: TURNS[0] }));
      if (dialogue.turns.length > TURNS[1]) problems.push(problem("tooMany", { field: "turns", max: TURNS[1] }));

      // Each turn: its shape, three different choices, one right answer, and every sentence's mapping.
      const turns = [];
      const sentences: SentenceInput[] = [];
      for (const [k, raw] of dialogue.turns.entries()) {
        const at = `turns[${k}]`;
        const turn = dialogueTurn.safeParse(raw, { reportInput: true });
        if (!turn.success) {
          problems.push(...zodProblems(turn.error, at));
          continue;
        }
        const { line, choices, correct } = turn.data;
        if (choices.length !== CHOICES) problems.push(problem("optionsCount", { field: `${at}.choices`, count: CHOICES }));
        else if (new Set(choices.map((choice) => same(choice.text))).size !== CHOICES) problems.push(problem("listRepeat", { field: `${at}.choices` }));
        if (!Number.isInteger(correct) || correct < 0 || correct >= choices.length) problems.push(problem("answerOutOfRange", { field: `${at}.correct` }));
        turns.push(turn.data);
        sentences.push(line, ...choices);
      }
      const mapped = sentences.map((sentence) => mapSentence(sentence, vocabulary));
      for (const item of mapped) problems.push(...item.problems);

      const existing = await tx.dialogue.findUnique({ where: { language_code: { language: batch.language, code } } });
      if (existing && !editable.has(existing.status)) problems.push(problem("locked", { code }));
      if (problems.length > 0) {
        reject(problems);
        continue;
      }

      let next = 0;
      const store = async () => {
        const k = next++;
        return (await storeSentence(tx, batch, { sentence: sentences[k], rows: mapped[k].rows!, vocabulary, level, label: code }, round, seen)).id;
      };
      const stored = [];
      for (const turn of turns) {
        const sentence_id = await store();
        const choices = [];
        for (let c = 0; c < turn.choices.length; c++) choices.push({ sentence_id: await store() });
        stored.push({ sentence_id, speaker: turn.line.speaker, choices, correct: turn.correct, why_fa: turn.why_fa });
      }

      const data = { level, title_fa: dialogue.title_fa, situation_fa: dialogue.situation_fa, turns: stored as Prisma.InputJsonValue, ...trace(batch) };
      const saved = existing
        ? await tx.dialogue.update({ where: { id: existing.id }, data })
        : await tx.dialogue.create({ data: { language: batch.language, code, ...data } });
      if (existing) round.updated++;
      else round.added++;
      round.accepted.push({ label: `${code} · ${dialogue.title_fa}`, entity: { type: "dialogue", id: saved.id }, record, part: "dialogue" });
    }
    return round;
  },
};
