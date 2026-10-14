import { knownShare, sentenceViewOf, wordView, type BuildEnv } from "../build";
import { PRONOUNS, type ConjC, type Content, type UnitC, type WordC } from "../content";
import { levelIndex } from "../content";
import { strongestPartner } from "../answer";
import { seeded, type Rng } from "../random";
import type { Settings } from "../settings";
import { itemKey, type LearnerSnapshot } from "../state";
import type { LessonView, TableView, WordCard } from "./types";

/** What the learner knows and has seen, as the exercise builders need it (PRD §5.5, §5.7). */
export function makeEnv(content: Content, learner: LearnerSnapshot, settings: Settings, rng: Rng): BuildEnv {
  const introduced = new Set<number>();
  for (const item of learner.items) if (item.itemType === "word") introduced.add(item.itemId);
  const vocab = learner.skills.find((skill) => skill.skill === "vocab");
  const below = vocab?.knownBelow ? levelIndex(content, vocab.knownBelow) : -1;
  const known = (wordId: number) => {
    if (introduced.has(wordId)) return true;
    const word = content.words.get(wordId);
    if (!word) return false;
    return word.noCard || levelIndex(content, word.level) < below;
  };
  let n = 0;
  return {
    content,
    settings,
    vocabLevel: vocab?.level ?? content.levels[0],
    known,
    introduced,
    history: (key) => learner.history.get(key) ?? { codeCounts: {}, lastCode: null, recentSentences: [] },
    sentenceSeen: learner.sentenceSeen,
    confusionPartner: (wordId) => strongestPartner(learner.confusions, wordId),
    rng,
    nextId: () => `e${++n}`,
  };
}

/** A sentence that shows the word in use: the one with the most known words (PRD §5.2). */
function exampleOf(env: BuildEnv, word: WordC) {
  const ids = env.content.wordSentences.get(word.id) ?? [];
  let best: { id: number; share: number } | null = null;
  for (const id of ids) {
    const sentence = env.content.sentences.get(id);
    if (!sentence) continue;
    const share = knownShare(sentence, env.known, word.id);
    if (!best || share > best.share || (share === best.share && id < best.id)) best = { id, share };
  }
  const sentence = best ? env.content.sentences.get(best.id) : undefined;
  return sentence ? sentenceViewOf(sentence, env.content, { translation: true }) : null;
}

export function tableView(content: Content, table: ConjC): TableView {
  const verb = content.words.get(table.wordId);
  const rows = PRONOUNS[content.language].filter((item) => table.forms[item.key]).map((item) => ({ pronoun: item.label, form: table.forms[item.key] }));
  const text = rows.map((row) => `${row.pronoun.split("/")[0]} ${row.form}`).join(", ");
  return { id: table.id, verb: verb?.lemma ?? "", tense: table.tense, rows, speak: { text, lang: content.language, url: null } };
}

export function wordCard(env: BuildEnv, word: WordC): WordCard {
  const base = word.senseOf ? env.content.wordByCode.get(word.senseOf) : undefined;
  return {
    word: wordView(word, env.content),
    example: exampleOf(env, word),
    knownMeaning: base?.meanings[0] ?? null,
    collocations: word.collocations,
    tables: word.pos === "verb" ? env.content.conjugations.filter((table) => table.wordId === word.id).map((table) => tableView(env.content, table)) : [],
  };
}

export function lessonView(env: BuildEnv, unit: UnitC): LessonView {
  return {
    unitId: unit.id,
    title: unit.titleFa,
    lesson: unit.lessonFa,
    buildTable: unit.buildTable,
    examples: unit.exampleSentenceIds
      .map((id) => env.content.sentences.get(id))
      .filter((sentence) => !!sentence)
      .map((sentence) => sentenceViewOf(sentence!, env.content, { translation: true })),
    ruleLine: unit.ruleLineFa,
    commonMistake: unit.commonMistakeFa,
    canDo: unit.canDoFa,
  };
}

/** A random generator for one part of the build, so adding a part does not shift the others. */
export const partRng = (seed: string, part: string, id: string | number = "") => seeded(seed, part, id);

export const wordKey = (id: number) => itemKey("word", id);
