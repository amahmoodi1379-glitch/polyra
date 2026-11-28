import type { Analyzer, Token } from "./analyze";
import { formExceptions } from "./sentences";

/**
 * A grammar unit (P-U and P-G, PRD §6 and §14.6) in one file, `content/<language>/grammar/<LEVEL>/NN-name.txt`;
 * the files of a level are its units in teaching order. Header lines first, then sections:
 *
 *   code: fr-a1-etre-present
 *   title: فعل être در زمان حال
 *   scope: je suis، tu es، il est، nous sommes، vous êtes، ils sont
 *   can_do: می‌توانی بگویی کی هستی و حالت چطور است.
 *   rule: être یعنی «بودن» و بی‌قاعده است: je suis، tu es، il est …
 *   mistake: فارسی‌زبان‌ها گاهی می‌گویند «je es»؛ درست: je suis.
 *   tables: présent | irregular            (conjugation tables of this tense link here; optional class)
 *   lesson:
 *   … the Persian lesson, any number of lines …
 *   table:
 *   ضمیر | être
 *   je | suis
 *   sets:
 *   مذکر: le père, le livre
 *   examples:
 *   Je suis étudiant. | من دانشجو هستم.
 *   targets:
 *   Je [suis] content. | من خوشحالم. | d: es, est, sommes | hint: (être)
 *   Nous [sommes] à Paris et vous [êtes] à Lyon. | ما در پاریس هستیم و شما در لیون. | d: sont, êtes, suis / sommes, es, sont
 *   transforms:
 *   Je suis content. => Nous sommes contents. ; Nous sommes contentes. | جمله را با nous بنویس.
 *   translations:
 *   من خسته‌ام. => Je suis fatigué. ; Je suis fatiguée.
 *
 * A target has one or two [gaps]; `d:` three wrong options per gap (gaps apart with « / »), `ok:` other right
 * answers (per gap with « / »), `hint:`, `full:` other right word orders of the whole sentence (« ; »).
 * Every word must be of the unit's level or lower.
 */

export type TableLink = { tense: string; verbClass: string | null };
export type GrammarUnitSource = {
  file: string;
  level: string;
  order: number;
  listItem: { unit_code: string; title_fa: string; level: string; scope_fa: string; can_do_fa: string | null };
  answer: Record<string, unknown>;
  tables: TableLink[];
  sentenceCount: number;
};
type Note = { file: string; line: number; text: string };
export type BuiltGrammar = { units: GrammarUnitSource[]; errors: Note[]; notes: Note[]; exceptions: { code: string; surface: string }[] };

const SECTIONS = ["lesson", "table", "sets", "examples", "targets", "transforms", "translations"] as const;
type Section = (typeof SECTIONS)[number];
const HEADER_KEYS = ["code", "title", "scope", "can_do", "rule", "mistake", "tables"];

const tokensOf = (tokens: { surface: string; kind: Token["kind"]; code: string | null; meaning_fa: string | null }[]): Token[] =>
  tokens.map(({ surface, kind, code, meaning_fa }) => ({ surface, kind, code, meaning_fa }));
const cellOf = (cells: string[], key: string) => {
  const found = cells.find((item) => item.startsWith(`${key}:`));
  return found ? found.slice(key.length + 1).trim() : null;
};
const listOf = (value: string | null, by = ",") => (value ? value.split(by).map((item) => item.trim()).filter(Boolean) : []);

export function buildGrammar(analyzer: Analyzer, files: { file: string; text: string }[], level: string): BuiltGrammar {
  const out: BuiltGrammar = { units: [], errors: [], notes: [], exceptions: [] };
  for (const [fileIndex, { file, text }] of files.entries()) {
    const header = new Map<string, string>();
    const tables: TableLink[] = [];
    const sections = new Map<Section, { line: number; text: string }[]>();
    let section: Section | null = null;
    const say = (line: number, message: string) => out.errors.push({ file, line, text: message });
    for (const [index, raw] of text.split("\n").entries()) {
      const line = raw.replace(/\r$/, "");
      const name = line.trim().replace(/:$/, "") as Section;
      if (SECTIONS.includes(name) && line.trim().endsWith(":")) {
        section = name;
        sections.set(name, sections.get(name) ?? []);
        continue;
      }
      if (section) {
        if (line.trim() && !line.trim().startsWith("//")) sections.get(section)!.push({ line: index + 1, text: line.trim() });
        else if (section === "lesson" && !line.trim()) sections.get(section)!.push({ line: index + 1, text: "" });
        continue;
      }
      if (!line.trim() || line.trim().startsWith("//")) continue;
      const at = line.indexOf(":");
      const key = at > 0 ? line.slice(0, at).trim() : "";
      if (!HEADER_KEYS.includes(key)) {
        say(index + 1, `unknown header line (keys: ${HEADER_KEYS.join(", ")}; sections: ${SECTIONS.join(", ")})`);
        continue;
      }
      const value = line.slice(at + 1).trim();
      if (key === "tables") {
        const [tense, verbClass] = value.split("|").map((item) => item.trim());
        tables.push({ tense, verbClass: verbClass || null });
      } else header.set(key, value);
    }
    const code = header.get("code") ?? "";
    for (const key of ["code", "title", "scope", "rule", "mistake"]) if (!header.get(key)) say(1, `missing header «${key}:»`);
    if (!sections.get("lesson")?.some((item) => item.text)) say(1, "missing «lesson:»");

    const scope = { level };
    const sentence = (source: string, translation: string, line: number) => {
      const analysis = analyzer.analyze(source, scope);
      for (const problem of analysis.errors) say(line, problem);
      for (const note of analysis.notes) out.notes.push({ file, line, text: note });
      if (analysis.errors.length > 0) return null;
      out.exceptions.push(...formExceptions(analysis.tokens, (code) => analyzer.word(code)?.word.lemma));
      return { analysis, core: { text: analysis.text, tts_text: null as string | null, translation_fa: translation, tokens: tokensOf(analysis.tokens) } };
    };

    const examples = [];
    for (const item of sections.get("examples") ?? []) {
      const [source, translation, ...more] = item.text.split("|").map((part) => part.trim());
      if (!translation) {
        say(item.line, "needs « | » and the Persian translation");
        continue;
      }
      const built = sentence(source, translation, item.line);
      if (built && built.analysis.gaps.length > 0) say(item.line, "an example has no [gap]: take out the [ ]");
      else if (built) examples.push({ ...built.core, tts_text: cellOf(more, "tts") });
    }

    const targets = [];
    for (const item of sections.get("targets") ?? []) {
      const [source, translation, ...more] = item.text.split("|").map((part) => part.trim());
      if (!translation) {
        say(item.line, "needs « | » and the Persian translation");
        continue;
      }
      const built = sentence(source, translation, item.line);
      if (!built) continue;
      const { analysis } = built;
      const blanks = analysis.gaps.length;
      if (blanks !== 1 && blanks !== 2) {
        say(item.line, "a target has one or two [gaps]");
        continue;
      }
      const surfaces = analysis.gaps.map((gap) => analysis.text.slice(gap.start, gap.end));
      const wrong = listOf(cellOf(more, "d"), "/").map((part) => listOf(part));
      // «ok:  / x» is an answer for the second gap only, so an empty part keeps its place.
      const okCell = cellOf(more, "ok");
      const ok = okCell ? okCell.split("/").map((part) => listOf(part)) : [];
      if (wrong.length !== blanks || wrong.some((options) => options.length !== 3)) {
        say(item.line, `d: needs three wrong options${blanks === 2 ? " per gap, the two gaps apart with « / »" : ""}`);
        continue;
      }
      let marked = analysis.text;
      for (const gap of [...analysis.gaps].reverse()) marked = `${marked.slice(0, gap.start)}{{${marked.slice(gap.start, gap.end)}}}${marked.slice(gap.end)}`;
      const accepted = surfaces.map((surface, k) => [surface, ...(ok[k] ?? [])]);
      targets.push({
        sentence: built.core,
        marked_text: marked,
        blanks,
        accepted: blanks === 1 ? accepted[0] : accepted,
        distractors: blanks === 1 ? wrong[0] : wrong,
        hint: cellOf(more, "hint"),
        accepted_full: listOf(cellOf(more, "full"), ";").length ? listOf(cellOf(more, "full"), ";") : null,
      });
    }

    const transforms = [];
    for (const item of sections.get("transforms") ?? []) {
      const [pair, instruction] = item.text.split("|").map((part) => part.trim());
      const [source, outputs] = (pair ?? "").split("=>").map((part) => part?.trim());
      if (!source || !outputs || !instruction) {
        say(item.line, "a transform is «source => output ; other right output | Persian instruction»");
        continue;
      }
      const checked = sentence(source, "—", item.line);
      const results = listOf(outputs, ";").map((result) => sentence(result, "—", item.line));
      if (!checked) continue;
      // The texts as learners see them: a {code} mark only tells the analyzer which word it is.
      if (results.every((result) => result)) transforms.push({ instruction_fa: instruction, source: checked.core.text, accepted_outputs: results.map((result) => result!.core.text) });
    }

    const translations = [];
    for (const item of sections.get("translations") ?? []) {
      const [prompt, outputs] = item.text.split("=>").map((part) => part.trim());
      const results = listOf(outputs ?? "", ";");
      if (!prompt || results.length === 0) {
        say(item.line, "a translation is «Persian sentence => right answer ; other right answer»");
        continue;
      }
      const built = results.map((result) => sentence(result, prompt, item.line));
      if (built.some((result) => !result)) continue;
      translations.push({ prompt_fa: prompt, accepted_outputs: built.map((result) => result!.core.text), tokens: built[0]!.core.tokens });
    }

    const buildTable = (sections.get("table") ?? []).map((item) => item.text.split("|").map((cell) => cell.trim()));
    const sets = (sections.get("sets") ?? []).map((item) => {
      const [name, items] = item.text.split(":");
      return { name: name.trim(), items: listOf(items ?? "") };
    });
    const unitRecord = {
      unit_code: code,
      title_fa: header.get("title") ?? "",
      level,
      lesson_fa: (sections.get("lesson") ?? []).map((item) => item.text).join("\n").trim(),
      build_table: buildTable.length ? buildTable : null,
      example_sentences: examples,
      rule_line_fa: header.get("rule") ?? "",
      common_mistake_fa: header.get("mistake") ?? "",
      category_sets: sets.length ? sets : null,
      can_do_fa: header.get("can_do") ?? null,
    };
    out.units.push({
      file,
      level,
      order: fileIndex + 1,
      listItem: { unit_code: code, title_fa: unitRecord.title_fa, level, scope_fa: header.get("scope") ?? "", can_do_fa: unitRecord.can_do_fa },
      answer: { unit: unitRecord, targets, transforms, translations, issues: [] },
      tables,
      sentenceCount: targets.length,
    });
  }
  return out;
}
