/**
 * What a word's audio says (PRD §5.1, `audio_id`): a noun with its article, so the listener hears the
 * gender. French takes the indefinite article (`une voiture`, never elided), German the definite one
 * (`der Tisch`); a noun that only exists in the plural takes the plural article.
 */
type SpokenWord = { language: string; lemma: string; pos: string; gender: string | null; number: string | null };

const french: Record<string, string> = { m: "un", f: "une", mf: "un" };

export function spokenWord(word: SpokenWord): string {
  if (word.pos !== "noun") return word.lemma;
  if (word.language === "fr") {
    if (word.number === "pl_only") return `des ${word.lemma}`;
    return word.gender && french[word.gender] ? `${french[word.gender]} ${word.lemma}` : word.lemma;
  }
  if (word.number === "pl_only") return `die ${word.lemma}`;
  return word.gender && ["der", "die", "das"].includes(word.gender) ? `${word.gender} ${word.lemma}` : word.lemma;
}
