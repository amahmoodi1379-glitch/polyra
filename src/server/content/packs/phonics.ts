import type { PhonicsKind } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import { phonicsLessonRecord } from "@/schemas/phonics";
import { appSettingDefaults } from "@/server/settings/app-catalog";
import { checkLesson } from "../phonics-check";
import { describeProblem, zodProblems } from "../problems";

/**
 * A phonics lesson (P-H, PRD §8) in one file, `content/<language>/phonics/NN-name.txt`. The lesson's name
 * and kind come from the teacher's list (`phonics.lessons.<language>`), which also gives its order:
 *
 *   label: u و ou                      (exactly a label of the list)
 *   kind: contrast                     (the list's kind: contrast, rule or liaison)
 *   graphemes: u, û
 *   tip:
 *   … the Persian tip, any number of lines (a blank line starts a new paragraph) …
 *   words:                             (contrast and rule: the word, its meaning, two wrong spellings)
 *   tu | تو | tou, teu
 *   pairs:                             (contrast: the lesson's sound first, then the other)
 *   tu | tout | تو | همه
 *   sentences:                         (liaison: the sentence, then the indexes of the words a liaison follows)
 *   Les enfants arrivent. | 1
 */

export type PhonicsSource = { file: string; order_no: number; label: string; kind: PhonicsKind; record: Record<string, unknown> };
type Note = { file: string; line: number; text: string };
export type BuiltPhonics = { lessons: PhonicsSource[]; errors: Note[]; notes: Note[] };

const SECTIONS = ["tip", "words", "pairs", "sentences"] as const;
type Section = (typeof SECTIONS)[number];
const same = (a: string, b: string) => fold(a).replace(/\s+/g, " ").trim() === fold(b).replace(/\s+/g, " ").trim();

/** Letters a spelling of the language may have (DECISIONS.md 18 Nov 2026: fake spellings use the language's own letters). */
const LETTERS: Record<string, RegExp> = {
  fr: /^[a-zàâæçéèêëîïôœùûüÿ' -]+$/iu,
  de: /^[a-zäöüß' -]+$/iu,
};

const cells = (line: string) => line.split("|").map((cell) => cell.trim());
const list = (cell: string | undefined) => (cell ?? "").split(",").map((item) => item.trim()).filter(Boolean);

export function buildPhonics(files: { file: string; text: string }[], language: string): BuiltPhonics {
  const out: BuiltPhonics = { lessons: [], errors: [], notes: [] };
  const planned = (appSettingDefaults[`phonics.lessons.${language}`] as { label: string; kind: PhonicsKind }[] | undefined) ?? [];
  const letters = LETTERS[language];
  const seen = new Map<string, string>();

  for (const { file, text } of files) {
    const say = (line: number, message: string) => out.errors.push({ file, line, text: message });
    const header = new Map<string, string>();
    const parts: Record<Section, { line: number; text: string }[]> = { tip: [], words: [], pairs: [], sentences: [] };
    let section: Section | null = null;
    for (const [index, raw] of text.split("\n").entries()) {
      const line = raw.trim();
      if (line.startsWith("//")) continue;
      const name = line.replace(/:$/, "");
      if (line.endsWith(":") && (SECTIONS as readonly string[]).includes(name)) {
        section = name as Section;
        continue;
      }
      if (section === "tip") parts.tip.push({ line: index + 1, text: line });
      else if (!line) continue;
      else if (section) parts[section].push({ line: index + 1, text: line });
      else {
        const at = line.indexOf(":");
        if (at < 0) say(index + 1, "a header line needs «key: value»");
        else header.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
      }
    }

    const label = header.get("label") ?? "";
    const at = planned.findIndex((lesson) => same(lesson.label, label));
    if (!label) say(1, "missing header «label:»");
    else if (at < 0) say(1, `«${label}» is not a lesson of phonics.lessons.${language}`);
    const kind = planned[at]?.kind;
    if (kind && header.get("kind") !== kind) say(1, `the list gives «${label}» the kind ${kind}, not «${header.get("kind") ?? ""}»`);
    if (label && seen.has(fold(label))) say(1, `«${label}» is also the lesson of ${seen.get(fold(label))}`);
    if (label) seen.set(fold(label), file);
    if (!kind) continue;

    const tip = parts.tip.map((item) => item.text).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const words = parts.words.map((item) => {
      const [word, meaning, wrong] = cells(item.text);
      const spellings = list(wrong);
      for (const spelling of [word, ...spellings]) if (spelling && !letters.test(spelling)) say(item.line, `«${spelling}» has letters that are not ${language}`);
      return { text: word ?? "", meaning_fa: meaning ?? "", wrong_spellings: spellings };
    });
    const pairs = parts.pairs.map((item) => {
      const [a, b, aFa, bFa] = cells(item.text);
      return { a: a ?? "", b: b ?? "", a_fa: aFa ?? "", b_fa: bFa ?? "" };
    });
    const sentences = parts.sentences.map((item) => {
      const [sentence, indexes] = cells(item.text);
      const numbers = list(indexes).map(Number);
      if (numbers.some((n) => !Number.isInteger(n))) say(item.line, "liaison indexes are whole numbers, «1, 3»");
      return { text: sentence ?? "", liaison_after_word_index: numbers };
    });

    const record = { kind, sound_label: planned[at].label, graphemes: list(header.get("graphemes")), tip_fa: tip, example_words: words, minimal_pairs: pairs, liaison_sentences: sentences };
    const parsed = phonicsLessonRecord.safeParse(record, { reportInput: true });
    if (!parsed.success) {
      for (const problem of zodProblems(parsed.error)) say(1, describeProblem(problem, "chatbot"));
      continue;
    }
    const problems = checkLesson(parsed.data, kind);
    for (const problem of problems) say(1, describeProblem(problem, "chatbot"));
    if (problems.length > 0) continue;
    out.lessons.push({ file, order_no: at + 1, label: planned[at].label, kind, record });
  }
  out.lessons.sort((a, b) => a.order_no - b.order_no);
  return out;
}
