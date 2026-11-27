import { fold } from "@/engine/tokens";
import { dialogueRecord, dialogueTurn } from "@/schemas/speaking";
import { describeProblem, zodProblems } from "../problems";
import type { Analyzer, Token } from "./analyze";
import { formExceptions } from "./sentences";
import type { ReadLine } from "./texts";

/**
 * A situational dialogue (P-D, PRD §8b.4) in one file, `content/<language>/dialogues/<LEVEL>/NN-name.txt`;
 * file names give the order. The other person's line, then the learner's three choices: «+» the one
 * right in this situation, «-» the two that are surely wrong (grammar, meaning or tone), then why:
 *
 *   code: fr-a1-d001
 *   title: سفارش در کافه
 *   situation: در یک کافه هستی. گارسون سفارشت را می‌پرسد.
 *   turns:
 *   B: Bonjour, vous voulez quelque chose ? | سلام، چیزی میل دارید؟
 *   + Un café, s'il vous plaît. | یک قهوه، لطفاً.
 *   - Je suis un café. | من یک قهوه هستم.
 *   - Salut ! Un café. | سلام! یک قهوه.
 *   why: سفارش مؤدبانه همین است؛ «من یک قهوه هستم» بی‌معنی است و «Salut» با گارسون خودمانی است.
 *
 * Every word must be of the dialogue's level or lower; a wrong form in a wrong choice names its word
 * (`gegesst{essen}`). Choices are shown in the order written, so the right one moves between turns.
 */

/** The other person's lines and the right choices as read, for the «grammar before its unit» check; not loaded. */
export type DialogueSource = { file: string; level: string; order: number; code: string; situation: string; answer: Record<string, unknown>; codes: string[]; lines: ReadLine[] };
type Note = { file: string; line: number; text: string };
export type BuiltDialogues = { dialogues: DialogueSource[]; errors: Note[]; notes: Note[]; exceptions: { code: string; surface: string }[] };

const tokensOf = (tokens: Token[]): Token[] => tokens.map(({ surface, kind, code, meaning_fa }) => ({ surface, kind, code, meaning_fa }));
const same = (text: string) => fold(text).replace(/\s+/g, " ").trim();

type Turn = { line: Record<string, unknown> | null; choices: Record<string, unknown>[]; correct: number[]; why: string; at: number };

export function buildDialogues(analyzer: Analyzer, files: { file: string; text: string }[], level: string, language: string): BuiltDialogues {
  const out: BuiltDialogues = { dialogues: [], errors: [], notes: [], exceptions: [] };
  const codePattern = new RegExp(`^${language}-${level.toLowerCase()}-d\\d{3}$`);

  for (const [order, { file, text }] of files.entries()) {
    const say = (line: number, message: string) => out.errors.push({ file, line, text: message });
    const header = new Map<string, string>();
    const turns: Turn[] = [];
    const codes: string[] = [];
    const read: ReadLine[] = [];
    let inTurns = false;
    let ok = true;

    /** One sentence of the dialogue: analysed, its words mapped. */
    const sentence = (line: number, raw: string, speaker?: string | null, wrong = false) => {
      const [main, translation, ...rest] = raw.split("|").map((cell) => cell.trim());
      if (!translation) say(line, "missing the Persian translation after «|»");
      const analysis = analyzer.analyze(main, { level });
      for (const problem of analysis.errors) say(line, problem);
      for (const note of analysis.notes) out.notes.push({ file, line, text: note });
      if (analysis.errors.length > 0 || !translation) {
        ok = false;
        return null;
      }
      out.exceptions.push(...formExceptions(analysis.tokens, (code) => analyzer.word(code)?.word.lemma));
      codes.push(...analysis.tokens.map((token) => token.code).filter((code): code is string => code !== null));
      // A wrong choice may be wrong on purpose: only the lines a learner takes as a model count.
      if (!wrong) read.push({ line, text: analysis.text, tokens: analysis.tokens.map((token) => ({ surface: token.surface, code: token.code, inGap: false })) });
      const tts = rest.find((cell) => cell.startsWith("tts:"));
      return { ...(speaker === undefined ? {} : { speaker }), text: analysis.text, tts_text: tts ? tts.slice(4).trim() : null, translation_fa: translation, tokens: tokensOf(analysis.tokens) };
    };

    for (const [index, raw] of text.split("\n").entries()) {
      const at = index + 1;
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      if (line === "turns:") {
        inTurns = true;
        continue;
      }
      if (!inTurns) {
        const colon = line.indexOf(":");
        if (colon < 0) say(at, "a header line needs «key: value»");
        else header.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
        continue;
      }
      const turn = turns.at(-1);
      if (line.startsWith("+ ") || line.startsWith("- ")) {
        if (!turn) {
          say(at, "a choice before the other person's first line");
          ok = false;
          continue;
        }
        if (line.startsWith("+")) turn.correct.push(turn.choices.length);
        const choice = sentence(at, line.slice(2), undefined, line.startsWith("-"));
        if (choice) turn.choices.push(choice);
      } else if (line.startsWith("why:")) {
        if (!turn) say(at, "«why:» before the first turn");
        else turn.why = line.slice(4).trim();
      } else {
        const colon = line.indexOf(":");
        const speaker = colon > 0 && colon < 4 ? line.slice(0, colon).trim() : null;
        if (!speaker) say(at, "the other person's line starts with its speaker («B: …»)");
        turns.push({ line: sentence(at, speaker ? line.slice(colon + 1) : line, speaker), choices: [], correct: [], why: "", at });
      }
    }

    const code = header.get("code") ?? "";
    for (const key of ["code", "title", "situation"]) if (!header.get(key)) say(1, `missing header «${key}:»`);
    if (code && !codePattern.test(code)) say(1, `code «${code}» should look like ${language}-${level.toLowerCase()}-d001`);
    for (const turn of turns) {
      if (turn.correct.length !== 1) say(turn.at, `a turn needs exactly one «+» choice, not ${turn.correct.length}`);
      if (!turn.why) say(turn.at, "a turn needs «why:»");
      if (new Set(turn.choices.map((choice) => same(String(choice.text)))).size !== turn.choices.length) say(turn.at, "two choices are the same");
    }
    const places = new Set(turns.map((turn) => turn.correct[0]));
    if (turns.length > 2 && places.size === 1) say(1, "the right choice is in the same place in every turn; move it");
    if (!ok || out.errors.some((error) => error.file === file)) continue;

    const dialogue = {
      code,
      level,
      title_fa: header.get("title") ?? "",
      situation_fa: header.get("situation") ?? "",
      turns: turns.map((turn) => ({ line: turn.line, choices: turn.choices, correct: turn.correct[0], why_fa: turn.why })),
    };
    const parsed = dialogueRecord.safeParse(dialogue, { reportInput: true });
    const problems = parsed.success ? [] : zodProblems(parsed.error, "dialogue");
    for (const [k, raw] of dialogue.turns.entries()) {
      const checked = dialogueTurn.safeParse(raw, { reportInput: true });
      if (!checked.success) problems.push(...zodProblems(checked.error, `turns[${k}]`));
    }
    for (const problem of problems) say(1, describeProblem(problem, "chatbot"));
    if (problems.length > 0) continue;
    out.dialogues.push({ file, level, order, code, situation: dialogue.situation_fa, answer: { dialogue, issues: [] }, codes: [...new Set(codes)], lines: read });
  }
  return out;
}
