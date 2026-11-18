import type { WordRecord } from "@/schemas/words";
import { languageInfo, type LanguageCode } from "./languages";
import { PRODUCE_LEVELS } from "./mastery";
import { problem, type Problem } from "./problems";

/** Language rules Zod cannot see (PRD §13.3, §14.2). Also fills defaults the PRD implies. */
export function checkWord(word: Pick<WordRecord, "pos" | "gender" | "number" | "plural" | "level" | "mastery" | "parts">, language: LanguageCode): Problem[] {
  const problems: Problem[] = [];
  const genders: readonly string[] = languageInfo[language].genders;
  if (word.pos === "noun") {
    if (!word.gender) problems.push(problem("nounNeedsGender", { field: "gender" }));
    else if (!genders.includes(word.gender)) {
      problems.push(problem("genderForLanguage", { value: word.gender, allowed: genders.join("، "), field: "gender" }));
    }
    word.number ??= "sg";
    // A noun used only in the singular has no plural to learn (die Milch, le courage).
    if (word.number === "sg_only") word.plural = null;
    if (language === "de" && word.number === "sg" && !word.plural) problems.push(problem("germanPlural", { field: "plural" }));
  } else {
    // Gender and number belong to nouns only; anything else the chatbot sent is dropped.
    word.gender = null;
    word.number = null;
  }
  if (PRODUCE_LEVELS.has(word.level) && word.mastery === "recognize") {
    problems.push(problem("masteryLowLevel", { field: "mastery" }));
  }
  if (word.pos === "phrase" && (!word.parts || word.parts.length === 0)) problems.push(problem("missing", { field: "parts" }));
  return problems;
}
