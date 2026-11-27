import { writingRecord } from "@/schemas/speaking";
import { describeProblem, zodProblems } from "../problems";
import { checkWriting, type Range } from "../production-rules";
import type { Analyzer } from "./analyze";

/**
 * Guided writing tasks (P-WR, PRD §8b.6; B1 and B2), one per file in
 * `content/<language>/writing/<LEVEL>/NN-name.txt`; file names give the order:
 *
 *   prompt: برای دوستت ایمیل بنویس و آخر هفته‌ات را تعریف کن.
 *   words: 60-120
 *   checklist:
 *   - دست‌کم دو فعل در passé composé
 *   phrases:
 *   Ce week-end, je suis allé(e)… | این آخر هفته رفتم…
 *   model:
 *   Salut Léa ! Ce week-end, …
 *   model_fa:
 *   سلام لئا! این آخر هفته …
 *
 * `words` lies inside `prompt.writing_words` of the level; 3 to 5 checklist items, 4 to 6 useful phrases;
 * the model answer has a word count inside `words` and only words of its level or lower (a word read
 * wrongly takes `{code}` after it). Lines of `model` and `model_fa` are joined with a line break.
 */

export type WritingSource = { file: string; level: string; order: number; key: string; record: Record<string, unknown>; codes: string[] };
type Note = { file: string; line: number; text: string };
export type BuiltWriting = { tasks: WritingSource[]; errors: Note[]; notes: Note[] };

const SECTIONS = ["checklist", "phrases", "model", "model_fa"] as const;

export function buildWriting(analyzer: Analyzer, files: { file: string; text: string }[], level: string, range: Range): BuiltWriting {
  const out: BuiltWriting = { tasks: [], errors: [], notes: [] };
  const seen = new Map<string, string>();
  for (const [order, { file, text }] of files.entries()) {
    const say = (line: number, message: string) => out.errors.push({ file, line, text: message });
    const header = new Map<string, string>();
    const sections: Record<(typeof SECTIONS)[number], { at: number; text: string }[]> = { checklist: [], phrases: [], model: [], model_fa: [] };
    let section: (typeof SECTIONS)[number] | null = null;
    for (const [index, raw] of text.split("\n").entries()) {
      const at = index + 1;
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      const name = line.endsWith(":") ? line.slice(0, -1).trim() : "";
      if ((SECTIONS as readonly string[]).includes(name)) {
        section = name as (typeof SECTIONS)[number];
        continue;
      }
      if (section) {
        sections[section].push({ at, text: section === "checklist" ? line.replace(/^-\s*/u, "") : line });
        continue;
      }
      const colon = line.indexOf(":");
      if (colon < 0) say(at, "a header line needs «key: value»");
      else header.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }

    for (const key of ["prompt", "words"]) if (!header.get(key)) say(1, `missing «${key}:»`);
    for (const key of SECTIONS) if (sections[key].length === 0) say(1, `missing «${key}:» and its lines`);
    const bounds = (header.get("words") ?? "").match(/^(\d+)\s*-\s*(\d+)$/u);
    if (header.get("words") && !bounds) say(1, "«words:» is «min-max», e.g. 60-120");

    const phrases = sections.phrases.map(({ at, text: line }) => {
      const [phrase, translation] = line.split("|").map((cell) => cell.trim());
      if (!translation) say(at, "a phrase needs its Persian after «|»");
      return { text: phrase, translation_fa: translation ?? "" };
    });
    const model = sections.model.map((line) => line.text).join("\n");
    const analysis = analyzer.analyze(model, { level });
    for (const problem of analysis.errors) say(sections.model[0]?.at ?? 1, problem);
    for (const note of analysis.notes) out.notes.push({ file, line: sections.model[0]?.at ?? 1, text: note });

    const record = {
      level,
      prompt_fa: header.get("prompt") ?? "",
      min_words: bounds ? Number(bounds[1]) : 0,
      max_words: bounds ? Number(bounds[2]) : 0,
      checklist_fa: sections.checklist.map((line) => line.text),
      useful_phrases: phrases,
      model_answer: analysis.text,
      model_answer_fa: sections.model_fa.map((line) => line.text).join("\n"),
    };
    const parsed = writingRecord.safeParse(record, { reportInput: true });
    const problems = parsed.success ? checkWriting(parsed.data, range) : zodProblems(parsed.error, "task");
    for (const problem of problems) say(1, describeProblem(problem, "chatbot"));
    const twin = seen.get(record.prompt_fa);
    if (twin) say(1, `the same prompt as ${twin}`);
    seen.set(record.prompt_fa, file);
    if (out.errors.some((error) => error.file === file)) continue;
    const codes = [...new Set(analysis.tokens.map((token) => token.code).filter((code): code is string => code !== null))];
    out.tasks.push({ file, level, order, key: record.prompt_fa, record, codes });
  }
  return out;
}
