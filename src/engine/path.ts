import type { Content, Track } from "./content";
import { grammarLevel, vocabLevelUp, type ItemIndex } from "./levels";
import type { SkillLevelE, TextStateE } from "./state";
import { indexTextStates, textLevelUp } from "./texts";
import type { Settings } from "./settings";

/**
 * «پایان مسیر» (PRD §3.13, T103): every skill at the language's last level, and each would move on by
 * its own rule (§9.6, §7.5) as if a level came after it; grammar has every unit of that level opened.
 * Only when that last level is published: below it the skill sheet says «سطح بعد به‌زودی» instead.
 */

/** A level after the last, for asking the level rules "would it move on?". */
const BEYOND = "beyond";

export function pathDone(content: Content, items: ItemIndex, skills: readonly SkillLevelE[], texts: readonly TextStateE[], settings: Settings, now: Date): boolean {
  const top = content.levels[content.levels.length - 1];
  if (!top || !content.openLevels.includes(top)) return false;
  const row = (skill: SkillLevelE["skill"]) => skills.find((item) => item.skill === skill);
  const vocab = row("vocab");
  const grammar = row("grammar");
  if (!vocab || vocab.level !== top) return false;
  if (!grammar || grammarLevel(content, items, grammar.knownBelow) !== top) return false;
  const beyond: Content = { ...content, levels: [...content.levels, BEYOND], openLevels: [...content.openLevels, BEYOND] };
  if (vocabLevelUp(beyond, items, vocab, settings) !== BEYOND) return false;
  if (!content.units.filter((unit) => unit.level === top).every((unit) => items.units.has(unit.id))) return false;
  const states = indexTextStates(texts);
  for (const track of ["listening", "reading"] as Track[]) {
    const level = row(track)?.level;
    if (level !== top || textLevelUp(beyond, states, track, top, settings, now, BEYOND) !== BEYOND) return false;
  }
  return true;
}
