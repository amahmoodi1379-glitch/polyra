import { appSettingDefaults } from "@/server/settings/app-catalog";
import { checkQuestionSets } from "../text-check";
import { describeProblem } from "../problems";
import type { Analyzer, Token } from "./analyze";
import { formExceptions } from "./sentences";

/**
 * A listening and reading text (P-T, PRD §7.1–§7.4) in one file, `content/<language>/texts/<LEVEL>/NN-name.txt`;
 * file names give the order. Header lines, the sentences, then the four question sets, one JSON question per line
 * in the P-T shape (mcq, tf, order, match, find, cloze, ctx, num, dict):
 *
 *   code: de-a1-t001
 *   title: Im Café
 *   kind: dialogue                        (a kind of the level's band in `prompt.text_kinds`)
 *   placement: yes                        (optional; placement_ok)
 *   key_words: Kaffee, Kuchen             (optional, up to 5 word codes of the text)
 *   sentences:
 *   A: Guten Tag! | سلام! | tts: …        (speaker before the colon in a dialogue; «-» for no speaker)
 *   reading A:
 *   {"type":"mcq","prompt":"…","options":["…","…","…","…"],"correct":1,"explanation_fa":"…"}
 *   reading B:
 *   listening A:
 *   listening B:
 *
 * Every word must be of the text's level or lower. Band and length come from `prompt.text_level_bands`
 * and `prompt.text_bands` (the defaults; the importer checks again with the live settings).
 */

type Note = { file: string; line: number; text: string };
export type TextSource = { file: string; level: string; order: number; code: string; kind: string; band: number; placement_ok: boolean; answer: Record<string, unknown>; codes: string[] };
export type BuiltTexts = { texts: TextSource[]; errors: Note[]; notes: Note[]; exceptions: { code: string; surface: string }[] };

const SETS = ["reading A", "reading B", "listening A", "listening B"] as const;
const tokensOf = (tokens: Token[]): Token[] => tokens.map(({ surface, kind, code, meaning_fa }) => ({ surface, kind, code, meaning_fa }));
const wordCount = (text: string) => text.split(/\s+/u).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;

export function textBand(level: string) {
  return ((appSettingDefaults["prompt.text_level_bands"] as Record<string, number[]>)[level] ?? [1])[0];
}

export function buildTexts(analyzer: Analyzer, files: { file: string; text: string }[], level: string): BuiltTexts {
  const out: BuiltTexts = { texts: [], errors: [], notes: [], exceptions: [] };
  const band = textBand(level);
  const [min, max] = (appSettingDefaults["prompt.text_bands"] as Record<string, [number, number]>)[String(band)];
  const kinds = (appSettingDefaults["prompt.text_kinds"] as Record<string, { kind: string; speakers: boolean }[]>)[String(band)] ?? [];
  for (const [order, { file, text }] of files.entries()) {
    const say = (line: number, message: string) => out.errors.push({ file, line, text: message });
    const header = new Map<string, string>();
    const sentences: { line: number; text: string }[] = [];
    const sets = new Map<string, { line: number; text: string }[]>();
    let section: string | null = null;
    for (const [index, raw] of text.split("\n").entries()) {
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      const name = line.replace(/:$/, "");
      if (line.endsWith(":") && (name === "sentences" || (SETS as readonly string[]).includes(name))) {
        section = name;
        continue;
      }
      if (section === "sentences") sentences.push({ line: index + 1, text: line });
      else if (section) sets.set(section, [...(sets.get(section) ?? []), { line: index + 1, text: line }]);
      else {
        const at = line.indexOf(":");
        if (at < 0) say(index + 1, "a header line needs «key: value»");
        else header.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
      }
    }
    for (const key of ["code", "title", "kind"]) if (!header.get(key)) say(1, `missing header «${key}:»`);
    const kind = kinds.find((item) => item.kind === header.get("kind"));
    if (header.get("kind") && !kind) say(1, `kind «${header.get("kind")}» is not a kind of band ${band}`);

    const records: Record<string, unknown>[] = [];
    const codes: string[] = [];
    let ok = true;
    for (const item of sentences) {
      const [main, translation, ...rest] = item.text.split("|").map((cell) => cell.trim());
      const at = main.indexOf(":");
      const speakerPart = at > 0 && at < 4 ? main.slice(0, at).trim() : null;
      const source = speakerPart !== null ? main.slice(at + 1).trim() : main.replace(/^-\s*/, "");
      const speaker = speakerPart && speakerPart !== "-" ? speakerPart : null;
      if (!translation) say(item.line, "missing the Persian translation after «|»");
      const analysis = analyzer.analyze(source, { level });
      for (const problem of analysis.errors) say(item.line, problem);
      for (const note of analysis.notes) out.notes.push({ file, line: item.line, text: note });
      if (analysis.errors.length > 0 || !translation) {
        ok = false;
        continue;
      }
      out.exceptions.push(...formExceptions(analysis.tokens, (code) => analyzer.word(code)?.word.lemma));
      codes.push(...analysis.tokens.map((token) => token.code).filter((code): code is string => code !== null));
      const tts = rest.find((cell) => cell.startsWith("tts:"));
      records.push({ speaker, text: analysis.text, tts_text: tts ? tts.slice(4).trim() : null, translation_fa: translation, tokens: tokensOf(analysis.tokens) });
    }
    if (kind?.speakers && records.some((record) => !record.speaker)) say(1, "every sentence of a dialogue needs a speaker («A: …»)");
    const words = records.reduce((sum, record) => sum + wordCount(record.text as string), 0);
    if (ok && (words < min || words > max)) say(1, `${words} words; band ${band} needs ${min} to ${max}`);

    const questionSets: Record<string, Record<string, unknown[]>> = { reading: { A: [], B: [] }, listening: { A: [], B: [] } };
    for (const name of SETS) {
      const [track, set] = name.split(" ");
      for (const item of sets.get(name) ?? []) {
        try {
          questionSets[track][set].push(JSON.parse(item.text));
        } catch {
          say(item.line, "a question must be one JSON object on one line");
          ok = false;
        }
      }
    }
    const placement_ok = /^(yes|true|1)$/i.test(header.get("placement") ?? "");
    if (ok) {
      const checked = checkQuestionSets(questionSets as never, { band, placement: placement_ok, sentences: records as never });
      for (const problem of checked.problems) say(1, describeProblem(problem, "chatbot"));
      if (checked.problems.length > 0) ok = false;
    }
    if (!ok) continue;
    const keyWords = (header.get("key_words") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    for (const code of keyWords) if (!codes.includes(code)) say(1, `key word «${code}» is not in the text`);
    out.texts.push({
      file,
      level,
      order,
      code: header.get("code")!,
      kind: header.get("kind")!,
      band,
      placement_ok,
      codes: [...new Set(codes)],
      answer: { code: header.get("code"), title: header.get("title"), kind: header.get("kind"), level, band, placement_ok, sentences: records, key_words: keyWords, question_sets: questionSets },
    });
  }
  return out;
}
