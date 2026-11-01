import { buildColloquialEx, buildConjEx, buildG0, buildGrammarEx, buildWordEx, sentenceViewOf, type BuildEnv, type GrammarSource } from "@/engine/build";
import { buildDrillEx, DRILL_CODES, drillReady } from "@/engine/drill";
import { hasCard, isColloquial, levelIndex, TRACKS, type Content, type SentenceC, type TargetC, type TextC, type UnitC, type WordC } from "@/engine/content";
import type { Ex, SentenceView } from "@/engine/ex";
import { exerciseDefs, type ExerciseFamily } from "@/engine/exercises";
import { seeded } from "@/engine/random";
import { lessonView, tableView, textView, wordCard, type LessonView, type TableView, type TextCard, type TextView, type WordCard } from "@/engine/session";
import type { Settings } from "@/engine/settings";
import type { Lang } from "@/engine/text";
import { attemptCost, stageRules, stagesOf, TEXT_RULE } from "@/engine/texts";
import { loadContent } from "@/server/learn/content";
import { engineSettings } from "@/server/settings/read";
import type { LibrarySlug } from "../library/slugs";

/**
 * «بازبینی» shows an item the way a learner gets it (PRD §13.9 step 4, owner decision): its card and
 * every exercise the engine builds from it, with the real builders and engine settings. A text shows
 * its key words and every stage of every attempt in both tracks. Dialogues, find-the-mistake, writing
 * and phonics get their learner screens later in phase 4; until then their review shows the form.
 */

export type Screen =
  | { kind: "word"; card: WordCard }
  | { kind: "lesson"; lesson: LessonView }
  | { kind: "table"; table: TableView }
  | { kind: "sentence"; sentence: SentenceView }
  | { kind: "exercise"; ex: Ex }
  /** «کلمه‌های این متن» (PRD §7.5). */
  | { kind: "textwords"; view: TextView; words: number[] }
  /** One stage of an attempt of a text in one track (PRD §7.4). */
  | { kind: "text"; view: TextView; info: TextCard };

export type Preview =
  | { state: "ready"; language: Lang; screens: Screen[]; words: Record<number, WordCard>; lessons: Record<number, LessonView> }
  /** later: no learner screen yet; missing: not shown to learners as it is (no meaning, an open word row); noCard: never a card. */
  | { state: "none"; reason: "later" | "missing" | "noCard" };

const codesOf = (family: ExerciseFamily) => exerciseDefs.filter((item) => item.family === family).map((item) => item.code);
const WORD_SENTENCE_CODES = ["W3b", "W3c", "W6a", "W6b"];
const TARGET_CODES = codesOf("grammar").filter((code) => !["G3a", "G6", "G6b"].includes(code));
const G0_COUNT = 3;

/**
 * A learner who knows every word up to the item's level, has seen nothing yet and has no confusions:
 * every exercise whose content is there can be built, with wrong options from that level and below.
 */
function reviewEnv(content: Content, settings: Settings, level: string | null, seed: string): BuildEnv {
  const ceiling = level ? levelIndex(content, level) : content.levels.length - 1;
  const introduced = new Set([...content.words.values()].filter((word) => hasCard(word) && levelIndex(content, word.level) <= ceiling).map((word) => word.id));
  let n = 0;
  return {
    content,
    settings,
    vocabLevel: level ?? content.levels[content.levels.length - 1],
    known: () => true,
    introduced,
    history: () => ({ codeCounts: {}, lastCode: null, recentSentences: [] }),
    sentenceSeen: new Map(),
    confusionPartner: () => null,
    rng: seeded("review", seed),
    nextId: () => `p${++n}`,
  };
}

const built = (list: (Ex | null)[]): Screen[] => list.filter((ex): ex is Ex => ex !== null).map((ex) => ({ kind: "exercise", ex }));

function wordScreens(env: BuildEnv, word: WordC): Screen[] {
  const colloquial = isColloquial(word);
  const exercises = codesOf(colloquial ? "colloquial" : "word").map((code) => (colloquial ? buildColloquialEx(env, word, code) : buildWordEx(env, word, code)));
  return [{ kind: "word", card: wordCard(env, word) }, ...built(exercises)];
}

/** A content where this word's only sentence is this one, so the sentence exercises use it. */
function onlySentence(content: Content, word: WordC, sentence: SentenceC, target: TargetC): Content {
  return {
    ...content,
    wordTargets: new Map(content.wordTargets).set(word.id, [target]),
    wordSentences: new Map(content.wordSentences).set(word.id, [sentence.id]),
  };
}

function targetScreens(env: BuildEnv, unit: UnitC, target: TargetC): Screen[] {
  const source: GrammarSource = { target };
  return built([buildG0(env, unit, target), ...TARGET_CODES.map((code) => buildGrammarEx(env, unit, code, source))]);
}

/** Every stage a text can come in: attempt 1 without and with help, attempt 2 and, above band 1, attempt 3; in each track. */
function textScreens(content: Content, settings: Settings, text: TextC): Screen[] {
  const screens: Screen[] = [];
  const attempts = text.band === 1 ? TEXT_RULE.band1Attempts : TEXT_RULE.attempts;
  const keyWords = text.keyWordIds.filter((wordId) => content.words.has(wordId));
  if (keyWords.length > 0) screens.push({ kind: "textwords", view: textView(content, text, "listening"), words: keyWords });
  for (const track of TRACKS) {
    const view = textView(content, text, track);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const set = attempt === 2 ? "B" : "A";
      for (const stage of stagesOf(attempt)) {
        const info: TextCard = {
          textId: text.id,
          track,
          attempt,
          stage,
          set,
          borrowed: false,
          rules: stageRules(text, track, attempt, stage),
          cost: attemptCost(text, track, { attempt, set }, settings),
          resume: null,
        };
        screens.push({ kind: "text", view, info });
      }
    }
  }
  return screens;
}

export async function previewItem(slug: LibrarySlug, language: string, id: number): Promise<Preview> {
  if (slug === "dialogues" || slug === "errorfix" || slug === "writing" || slug === "phonics") return { state: "none", reason: "later" };
  const [content, settings] = await Promise.all([loadContent(language, "review"), engineSettings()]);
  const words: Record<number, WordCard> = {};
  const lessons: Record<number, LessonView> = {};
  const ready = (screens: Screen[]): Preview => ({ state: "ready", language: content.language, screens, words, lessons });
  const unitOf = (unitId: number) => content.units.find((unit) => unit.id === unitId);
  const seed = `${slug}:${id}`;

  switch (slug) {
    case "texts": {
      const text = content.texts.find((item) => item.id === id);
      if (!text) return { state: "none", reason: "missing" };
      const env = reviewEnv(content, settings, text.level, seed);
      for (const wordId of text.keyWordIds) {
        const word = content.words.get(wordId);
        if (word) words[wordId] = wordCard(env, word);
      }
      return ready(textScreens(content, settings, text));
    }
    case "words": {
      const word = content.words.get(id);
      if (!word) return { state: "none", reason: "missing" };
      if (!hasCard(word) && !isColloquial(word)) return { state: "none", reason: "noCard" };
      const env = reviewEnv(content, settings, word.level, seed);
      words[word.id] = wordCard(env, word);
      return ready(wordScreens(env, word));
    }
    case "sentences": {
      const sentence = content.sentences.get(id);
      if (!sentence) return { state: "none", reason: "missing" };
      const screens: Screen[] = [{ kind: "sentence", sentence: sentenceViewOf(sentence, content, { translation: true }) }];
      // A bank sentence as it is heard alone, each of its three showings that its text allows (PRD §7.6).
      const heard = reviewEnv(content, settings, sentence.level, `${seed}:drill`);
      DRILL_CODES.forEach((code, count) => {
        if (drillReady(heard, sentence, { sentenceId: id, count, lastAt: null }, new Date()) === code) screens.push(...built([buildDrillEx(heard, sentence, code)]));
      });
      for (const target of [...content.targets.values()].filter((item) => item.sentenceId === id)) {
        if (target.type === "word") {
          const word = content.words.get(target.targetId);
          if (!word || !hasCard(word) || isColloquial(word)) continue;
          const env = reviewEnv(onlySentence(content, word, sentence, target), settings, sentence.level, `${seed}:${target.id}`);
          words[word.id] = wordCard(env, word);
          screens.push(...built(WORD_SENTENCE_CODES.map((code) => buildWordEx(env, word, code))));
        } else {
          const unit = unitOf(target.targetId);
          if (!unit) continue;
          const env = reviewEnv(content, settings, sentence.level, `${seed}:${target.id}`);
          lessons[unit.id] = lessonView(env, unit);
          screens.push(...targetScreens(env, unit, target));
        }
      }
      return ready(screens);
    }
    case "units": {
      const unit = unitOf(id);
      if (!unit) return { state: "none", reason: "missing" };
      const env = reviewEnv(content, settings, unit.level, seed);
      lessons[unit.id] = lessonView(env, unit);
      const warmUps = (content.unitTargets.get(unit.id) ?? []).map((target) => buildG0(env, unit, target)).filter((ex) => ex !== null);
      return ready([{ kind: "lesson", lesson: lessons[unit.id] }, ...built([...warmUps.slice(0, G0_COUNT), buildGrammarEx(env, unit, "G3a", { sets: true })])]);
    }
    case "tables": {
      const table = content.conjugations.find((item) => item.id === id);
      const verb = table && content.words.get(table.wordId);
      if (!table || !verb) return { state: "none", reason: "missing" };
      const env = reviewEnv(content, settings, verb.level, seed);
      return ready([{ kind: "table", table: tableView(content, table) }, ...built(codesOf("conjugation").map((code) => buildConjEx(env, table, code)))]);
    }
    case "transforms":
    case "translations": {
      const item = slug === "transforms" ? content.transforms.find((row) => row.id === id) : content.translates.find((row) => row.id === id);
      const unit = item && unitOf(item.unitId);
      if (!item || !unit) return { state: "none", reason: "missing" };
      const env = reviewEnv(content, settings, unit.level, seed);
      lessons[unit.id] = lessonView(env, unit);
      const source: GrammarSource = slug === "transforms" ? { transform: item as Content["transforms"][number] } : { translate: item as Content["translates"][number] };
      return ready(built([buildGrammarEx(env, unit, slug === "transforms" ? "G6" : "G6b", source)]));
    }
  }
}
