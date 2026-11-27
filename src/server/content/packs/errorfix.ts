import { fold } from "@/engine/tokens";
import { errorfixRecord } from "@/schemas/speaking";
import { describeProblem, zodProblems } from "../problems";
import { checkMarks, markPattern } from "../production-rules";
import type { Analyzer, Token } from "./analyze";
import { formExceptions } from "./sentences";

/**
 * Find-the-mistake items (P-E, PRD §8b.5; B1 and B2) in `content/<language>/errorfix/<LEVEL>/NN-name.txt`,
 * several per file with a blank line between them; file names and places give the order:
 *
 *   units: fr-a1-passe-compose-avoir, fr-a1-possessifs-2
 *   text: Hier, nous {{sommes|avons}} mangé au restaurant avec {{notre|nos}} amis.
 *   fa: دیروز با دوستانمان در رستوران غذا خوردیم.
 *   why: manger در گذشته با avoir می‌آید، نه être.
 *   why: amis جمع است، پس صفت ملکی nos است، نه notre.
 *
 * Two or three mistakes, each one word marked {{wrong|right}}, and one `why:` per mistake in their order.
 * The corrected text uses words of its level or lower (a word read wrongly takes `{code}` after it, also
 * right after a mark); `units` are codes of grammar units of this level or below.
 */

export type ErrorfixSource = { file: string; line: number; level: string; key: string; record: Record<string, unknown>; codes: string[] };
type Note = { file: string; line: number; text: string };
export type BuiltErrorfix = { items: ErrorfixSource[]; errors: Note[]; notes: Note[]; exceptions: { code: string; surface: string }[] };

const tokensOf = (tokens: Token[]): Token[] => tokens.map(({ surface, kind, code, meaning_fa }) => ({ surface, kind, code, meaning_fa }));
const MARK = /^\{\{[^{}|]*\|([^{}|]*)\}\}$/u;

/** The text as stored (marks kept, `{code}` dropped) and as analysed (marks resolved, `{code}` kept). */
export function splitMarked(source: string) {
  const pieces = source.split(/(\{\{[^{}|]*\|[^{}|]*\}\})/u);
  const marked = pieces.map((piece, index) => (index % 2 ? piece : piece.replace(/\{[^{}]*\}/gu, ""))).join("");
  const corrected = pieces.map((piece, index) => (index % 2 ? piece.replace(MARK, (_, right: string) => right.trim()) : piece)).join("");
  return { marked, corrected };
}

export function buildErrorfix(analyzer: Analyzer, files: { file: string; text: string }[], level: string, units: Set<string>): BuiltErrorfix {
  const out: BuiltErrorfix = { items: [], errors: [], notes: [], exceptions: [] };
  const seen = new Map<string, string>();
  for (const { file, text } of files) {
    const blocks: { line: number; rows: { at: number; key: string; value: string }[] }[] = [];
    let current: (typeof blocks)[number] | null = null;
    for (const [index, raw] of text.split("\n").entries()) {
      const line = raw.trim();
      if (line.startsWith("//")) continue;
      if (!line) {
        current = null;
        continue;
      }
      if (!current) {
        current = { line: index + 1, rows: [] };
        blocks.push(current);
      }
      const colon = line.indexOf(":");
      current.rows.push({ at: index + 1, key: colon > 0 ? line.slice(0, colon).trim() : "", value: colon > 0 ? line.slice(colon + 1).trim() : line });
    }

    for (const block of blocks) {
      const say = (message: string) => out.errors.push({ file, line: block.line, text: message });
      const one = (key: string) => block.rows.find((row) => row.key === key)?.value ?? "";
      const unknown = block.rows.filter((row) => !["units", "text", "fa", "why"].includes(row.key));
      for (const row of unknown) out.errors.push({ file, line: row.at, text: `unknown line «${row.key || row.value}» (units:, text:, fa:, why:)` });
      const source = one("text");
      const unitCodes = one("units").split(/[,،]/u).map((code) => code.trim()).filter(Boolean);
      const whys = block.rows.filter((row) => row.key === "why").map((row) => row.value);
      for (const key of ["units", "text", "fa"]) if (!one(key)) say(`missing «${key}:»`);
      for (const code of unitCodes) if (!units.has(code)) say(`«${code}» is not a grammar unit of ${level} or below`);
      if (!source) continue;

      const { marked, corrected } = splitMarked(source);
      for (const problem of checkMarks(marked, whys.length)) say(describeProblem(problem, "chatbot"));
      const analysis = analyzer.analyze(corrected, { level });
      for (const problem of analysis.errors) say(problem);
      for (const note of analysis.notes) out.notes.push({ file, line: block.line, text: note });
      if (fold(analysis.text) !== fold(marked.replace(markPattern, (_, __, right: string) => right.trim()))) say("the text and its corrected form do not match; check the marks");
      const key = fold(analysis.text).replace(/\s+/gu, " ").trim();
      const twin = seen.get(key);
      if (twin) say(`the same corrected text as ${twin}`);
      seen.set(key, `${file}:${block.line}`);

      const record = {
        level,
        marked_text: marked,
        translation_fa: one("fa"),
        unit_codes: unitCodes,
        errors: whys.map((why_fa) => ({ why_fa })),
        tokens: tokensOf(analysis.tokens),
      };
      const parsed = errorfixRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) for (const problem of zodProblems(parsed.error, "item")) say(describeProblem(problem, "chatbot"));
      if (out.errors.some((error) => error.file === file && error.line >= block.line && error.line <= block.rows.at(-1)!.at)) continue;
      out.exceptions.push(...formExceptions(analysis.tokens, (code) => analyzer.word(code)?.word.lemma));
      const codes = [...new Set(analysis.tokens.map((token) => token.code).filter((code): code is string => code !== null))];
      out.items.push({ file, line: block.line, level, key: analysis.text, record, codes });
    }
  }
  return out;
}
