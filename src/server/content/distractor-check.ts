import { fold } from "@/engine/tokens";
import { problem, type Problem } from "./problems";
import type { VocabWord } from "./vocabulary";

/**
 * The wrong options of a word's fill-in sentence (W3b, PRD §5.5, §14.2), checked the way item writers
 * check multiple-choice options: a wrong option must be wrong in the sentence, and the learner must not
 * rule it out from the grammar around the blank instead of the meaning.
 *
 * - `synonyms` (refused): a wrong option with the target's concept or meaning would also be right.
 * - `cues` (warnings): a wrong option of another part of speech, a German capital that gives the noun
 *   away, or a noun whose gender does not fit the article before the blank.
 */

/** Genders an article in front of the blank allows. Plural and elided articles say nothing. */
const ARTICLE_GENDERS: Record<string, Record<string, string[]>> = {
  fr: {
    le: ["m", "mf"],
    un: ["m", "mf"],
    ce: ["m", "mf"],
    cet: ["m", "mf"],
    du: ["m", "mf"],
    au: ["m", "mf"],
    mon: ["m", "mf"],
    ton: ["m", "mf"],
    son: ["m", "mf"],
    la: ["f", "mf"],
    une: ["f", "mf"],
    cette: ["f", "mf"],
    ma: ["f", "mf"],
    ta: ["f", "mf"],
    sa: ["f", "mf"],
  },
  de: {
    der: ["der", "die"],
    die: ["die"],
    das: ["das"],
    des: ["der", "das"],
    dem: ["der", "das"],
    den: ["der"],
    ein: ["der", "das"],
    eine: ["die"],
    einen: ["der"],
    einem: ["der", "das"],
    eines: ["der", "das"],
    einer: ["die"],
  },
};

const tidyMeaning = (text: string | null) => (text ? text.replace(/[\s‌]+/g, " ").trim() : "");

export type DistractorReport = { synonyms: Problem[]; cues: Problem[] };

/**
 * `markedText` has one blank ({{…}}) on the target word; `distractors` are its three wrong options.
 * Only words of the list are judged: an option the list does not know is left alone.
 */
export function checkWordDistractors(input: {
  markedText: string;
  distractors: string[];
  target: VocabWord;
  words: readonly VocabWord[];
  language: string;
  field: string;
}): DistractorReport {
  const { markedText, distractors, target, words, language, field } = input;
  const report: DistractorReport = { synonyms: [], cues: [] };
  const byForm = new Map<string, VocabWord[]>();
  for (const word of words) {
    for (const form of new Set([word.lemma, word.plural, ...word.forms].filter((item): item is string => !!item).map(fold))) {
      byForm.set(form, [...(byForm.get(form) ?? []), word]);
    }
  }
  const meaning = tidyMeaning(target.meaning_fa);
  const blank = markedText.search(/\{\{/);
  const before = blank >= 0 ? markedText.slice(0, blank) : "";
  const midSentence = /[\p{L}\p{N}][^.!?]*$/u.test(before);
  const article = before.match(/(\p{L}+)\s+$/u)?.[1];
  const allowed = article ? ARTICLE_GENDERS[language]?.[fold(article)] : undefined;
  const answer = markedText.match(/\{\{(.*?)\}\}/)?.[1]?.trim() ?? target.lemma;

  for (const value of distractors) {
    const option = value.trim();
    const matches = (byForm.get(fold(option)) ?? []).filter((word) => word.id !== target.id);
    const synonym = matches.find(
      (word) => (target.concept_id !== null && word.concept_id === target.concept_id) || (meaning !== "" && tidyMeaning(word.meaning_fa) === meaning),
    );
    if (synonym) {
      report.synonyms.push(problem("distractorSynonym", { value: option, meaning: target.meaning_fa ?? target.lemma, field }));
      continue;
    }
    if (matches.length > 0 && !matches.some((word) => word.pos === target.pos)) {
      report.cues.push(problem("distractorPos", { value: option, field }));
      continue;
    }
    // German nouns have a capital: mid-sentence, the one option that has (or lacks) it is the answer.
    if (language === "de" && midSentence && isUpper(option) !== isUpper(answer)) {
      report.cues.push(problem("distractorCase", { value: option, field }));
      continue;
    }
    if (allowed && target.pos === "noun" && target.gender && allowed.includes(target.gender)) {
      const nouns = matches.filter((word) => word.pos === "noun" && word.gender);
      if (nouns.length > 0 && !nouns.some((word) => allowed.includes(word.gender!))) {
        report.cues.push(problem("distractorGender", { value: option, article: article!, field }));
      }
    }
  }
  return report;
}

const isUpper = (text: string) => {
  const first = text.match(/\p{L}/u)?.[0] ?? "";
  return first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
};
