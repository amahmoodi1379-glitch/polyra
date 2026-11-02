import { indexItems, levelsAfter, type ItemIndex } from "@/engine/levels";
import type { SkillLevelE, SkillName } from "@/engine/state";
import { textLevelsAfter } from "@/engine/texts";
import type { Prisma } from "@/generated/prisma/client";
import { itemStateOf, loadTextStates, skillsOf, textStateOf } from "./learner";
import type { LearnContext } from "./session";

/**
 * Skill levels after a session (PRD §9.6, §6.2, §7.5). Every closed session moves them, finished or
 * left: what the learner answered counts either way, so a learner who often leaves a session half-way
 * still goes up a level (DECISIONS.md).
 */
export async function updateLevels(tx: Prisma.TransactionClient, who: { userId: number; language: string }, ctx: LearnContext, at: Date) {
  const { content, settings } = ctx;
  const where = { user_id: who.userId, language: who.language };
  const [itemRows, skillRows, textRows] = await Promise.all([tx.itemState.findMany({ where }), tx.skillLevel.findMany({ where }), loadTextStates(tx, who.userId, who.language)]);
  const items = itemRows.map(itemStateOf);
  const index: ItemIndex = indexItems(items);
  const skills: SkillLevelE[] = skillsOf(skillRows, content.levels[0]);
  const vocab = skills.find((skill) => skill.skill === "vocab")!;
  const levelOf = (skill: SkillName) => skills.find((item) => item.skill === skill)?.level ?? null;
  const words = levelsAfter(content, index, skills, settings);
  const moved = { ...words, ...textLevelsAfter(content, textRows.map(textStateOf), levelOf, settings, at, words.vocab ?? vocab.level) };
  for (const skill of ["vocab", "grammar", "listening", "reading"] as const) {
    const level = moved[skill];
    const row = skills.find((item) => item.skill === skill)!;
    if (!level) continue;
    row.level = level;
    await tx.skillLevel.upsert({
      where: { user_id_language_skill: { ...where, skill } },
      create: { ...where, skill, level, known_below: row.knownBelow },
      update: { level },
    });
  }
  return { items, index, skills };
}
