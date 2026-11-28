import { plausibleForm } from "@/engine/tokens";
import type { Analyzer, MappedToken, Token } from "./analyze";
import { autoDistractors } from "./distractors";
import type { PackWord } from "./words";
import type { TimingLine } from "./timing";

/**
 * A word's fill-the-gap sentences (P-S, PRD §5.5 and §14.4), written in a short form:
 *
 *   # voiture
 *   Ma [voiture] est dans le garage. | ماشینم در پارکینگ است.
 *   Elle [habite] à Lyon. | او در لیون زندگی می‌کند.
 *   Il lave sa [voiture] le samedi. | او شنبه‌ها ماشینش را می‌شوید. | d: maison, table, chaise | ok: auto
 *
 * `# code` starts a word's block; each line is one sentence with its gap, a bar, the Persian
 * translation, and optional cells: `d:` three wrong options (else made by distractors.ts), `ok:` other
 * right answers, `tts:` the text the machine voice reads. The same sentence may stand in two blocks: it
 * becomes one sentence with two targets. Every other word must be taught before the block's word.
 */

export type SentenceRecord = {
  text: string;
  tts_text: string | null;
  translation_fa: string;
  tokens: Token[];
  targets: { type: "word"; target: string; marked_text: string; blanks: 1; accepted: string[]; distractors: string[]; hint: string | null; accepted_full: null }[];
};
export type BuiltSentences = {
  records: SentenceRecord[];
  errors: { file: string; line: number; text: string }[];
  notes: { file: string; line: number; text: string }[];
  exceptions: { code: string; surface: string }[];
  wordsWithSentences: Map<PackWord, number>;
  /** Every accepted line with its tokens, for the «grammar before its lesson» check (`timing.ts`). */
  lines: TimingLine[];
};

const cell = (cells: string[], key: string) => {
  const found = cells.find((item) => item.startsWith(`${key}:`));
  return found ? found.slice(key.length + 1).trim() : null;
};
const list = (value: string | null) => (value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []);

/**
 * The tokens whose surface the import's plausibility rule (PRD §14.1 rule 5, `plausibleForm`) would
 * doubt, such as «suis» for être: the pack confirms them as form exceptions, as the teacher would.
 * Conjugation tables are left out of the check, so a few more forms are confirmed than strictly needed.
 */
export function formExceptions(tokens: MappedToken[], lemmaOfCode: (code: string) => string | undefined = () => undefined): { code: string; surface: string }[] {
  return tokens
    .filter((token) => token.word && token.kind === "word")
    .filter((token) => {
      const word = token.word!.word;
      const entry = { id: 0, lemma: word.lemma, plural: word.plural, pos: word.pos, forms: [], partLemmas: (word.parts ?? []).map((code) => lemmaOfCode(code) ?? code) };
      const segments = token.surface.split(/\s*(?:\.{3}|…)\s*/u).filter((segment) => segment.trim() !== "");
      return !plausibleForm(token.surface, entry, segments);
    })
    .map((token) => ({ code: token.word!.word.code, surface: token.surface }));
}

/**
 * Does a gap after this text open a sentence of its own («Tu viens ? – [Oui]», «Danke. [Gern] geschehen»)?
 * Its wrong options are then written with a capital, like the answer, so the capital gives nothing away.
 */
export const opensSentence = (before: string) => /(^|[.!?…])\s*([–—]\s*)?([«„“"]\s*)?$/u.test(before.trimEnd());

/** Builds the P-S records of the sentence files of one level. */
export function buildSentences(analyzer: Analyzer, files: { file: string; text: string }[], level: string, firstWords: Set<PackWord>): BuiltSentences {
  const out: BuiltSentences = { records: [], errors: [], notes: [], exceptions: [], wordsWithSentences: new Map(), lines: [] };
  const byText = new Map<string, SentenceRecord>();
  for (const { file, text } of files) {
    let target: PackWord | null = null;
    for (const [index, raw] of text.split("\n").entries()) {
      const at = { file, line: index + 1 };
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      if (line.startsWith("#")) {
        const code = line.slice(1).trim();
        target = analyzer.word(code) ?? null;
        if (!target) out.errors.push({ ...at, text: `no word with code «${code}» in the lists` });
        else if (target.level !== level) out.errors.push({ ...at, text: `«${code}» is a ${target.level} word; its sentences go in ${target.level}` });
        continue;
      }
      if (!target) {
        out.errors.push({ ...at, text: "a sentence before any «# code» line" });
        continue;
      }
      const cells = line.split("|").map((item) => item.trim());
      const [source, translation = "", ...more] = cells;
      if (!translation) {
        out.errors.push({ ...at, text: "needs « | » and the Persian translation" });
        continue;
      }
      const analysis = analyzer.analyze(source, { level, target, firstWords });
      for (const problem of analysis.errors) out.errors.push({ ...at, text: problem });
      for (const note of analysis.notes) out.notes.push({ ...at, text: note });
      if (analysis.errors.length > 0) continue;
      if (analysis.gaps.length !== 1) {
        out.errors.push({ ...at, text: "a word's sentence has exactly one [gap]" });
        continue;
      }
      const gap = analysis.gaps[0];
      const inside = analysis.tokens.filter((token) => token.inGap === 0);
      if (inside.length !== 1 || inside[0].word !== target) {
        out.errors.push({ ...at, text: `the [gap] must hold «${target.word.code}» and nothing else (it holds ${inside.map((token) => token.code ?? token.surface).join(", ") || "nothing"})` });
        continue;
      }
      if (inside[0].surface.includes(" ... ")) {
        out.errors.push({ ...at, text: "a separable verb in a gap must stand whole (infinitive or participle), not split" });
        continue;
      }
      const surface = analysis.text.slice(gap.start, gap.end);
      const position = analysis.tokens.indexOf(inside[0]);
      const before = analysis.tokens[position - 1] ?? null;
      const after = analysis.tokens[position + 1] ?? null;
      const given = list(cell(more, "d"));
      let distractors = given;
      let hint: string | null = null;
      const auto = autoDistractors(analyzer.morph, analyzer.words, target, surface, {
        sentence: analysis.text,
        used: new Set(analysis.tokens.map((token) => token.word).filter((word): word is PackWord => word !== null)),
        before: before && analysis.text.slice(before.end, gap.start).trim() === "" ? before.surface : null,
        after: after && analysis.text.slice(gap.end, after.start).trim() === "" ? after.surface : null,
        first: gap.start === 0 || (opensSentence(analysis.text.slice(0, gap.start)) && /^\p{Lu}/u.test(surface)),
        knownBefore: (word) => analyzer.knownBefore(word, { level, target: target!, firstWords }),
        level,
      });
      if ("error" in auto) {
        if (given.length === 0) {
          out.errors.push({ ...at, text: auto.error });
          continue;
        }
      } else {
        hint = auto.hint;
        if (given.length === 0) distractors = auto.options;
      }
      if (distractors.length !== 3) {
        out.errors.push({ ...at, text: "d: needs exactly three wrong options" });
        continue;
      }
      const okAnswers = new Set([surface, ...list(cell(more, "ok"))].map((item) => item.toLowerCase()));
      const alsoRight = distractors.filter((item) => okAnswers.has(item.toLowerCase()));
      if (alsoRight.length > 0) {
        out.errors.push({ ...at, text: `the wrong option «${alsoRight.join("», «")}» is also a right answer (the gap or ok:)${given.length ? "" : "; write d: with three surely wrong options"}` });
        continue;
      }
      out.lines.push({ ...at, target, text: analysis.text, tokens: analysis.tokens.map((token) => ({ surface: token.surface, code: token.code, inGap: token.inGap !== null })) });
      const markedText = `${analysis.text.slice(0, gap.start)}{{${surface}}}${analysis.text.slice(gap.end)}`;
      const targetRecord = { type: "word" as const, target: target.word.code, marked_text: markedText, blanks: 1 as const, accepted: [surface, ...list(cell(more, "ok"))], distractors, hint, accepted_full: null };
      const existing = byText.get(analysis.text);
      if (existing) {
        if (existing.translation_fa !== translation) out.errors.push({ ...at, text: "the same sentence has another translation elsewhere" });
        else if (!existing.targets.some((item) => item.target === target!.word.code)) existing.targets.push(targetRecord);
      } else {
        const record: SentenceRecord = {
          text: analysis.text,
          tts_text: cell(more, "tts"),
          translation_fa: translation,
          tokens: analysis.tokens.map(({ surface, kind, code, meaning_fa }) => ({ surface, kind, code, meaning_fa })),
          targets: [targetRecord],
        };
        byText.set(analysis.text, record);
        out.records.push(record);
        out.exceptions.push(...formExceptions(analysis.tokens, (code) => analyzer.word(code)?.word.lemma));
      }
      out.wordsWithSentences.set(target, (out.wordsWithSentences.get(target) ?? 0) + 1);
    }
  }
  return out;
}
