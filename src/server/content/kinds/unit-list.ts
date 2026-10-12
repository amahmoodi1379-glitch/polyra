import { t } from "@/i18n";
import { unitListItem } from "@/schemas/grammar";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import type { LevelTargets } from "@/server/settings/app-catalog";
import { levelOrder, levelRank } from "../languages";
import { problem, zodProblems, type Problem } from "../problems";
import { emptyRound } from "../report";
import { example, labelOf, languageValues, lines, params, trace } from "./shared";
import type { ContentKind } from "./types";

type UnitListParams = { level: string };

const editable = new Set(["draft", "needs_review"]);

/**
 * P-U (PRD §14.5): the full list of grammar units of one level. Each unit becomes a draft
 * grammar_unit with code, title, scope and order (PRD §13.9); P-G fills it in later. Importing the
 * list again updates units still in draft and keeps approved ones as they are (PRD §14.9).
 */
export const unitList: ContentKind = {
  kind: "P_U",
  template: "P-U.md",
  rootKey: "units",

  async plan(language, options) {
    const levels = await appSetting<string[]>(`levels.${language}`);
    let level = options.level && levels.includes(options.level) ? options.level : null;
    if (!level) {
      const made = await db.grammarUnit.groupBy({ by: ["level"], where: { language } });
      const done = new Set(made.map((row) => row.level));
      level = levels.find((candidate) => !done.has(candidate)) ?? null;
    }
    if (!level) return { nothing: t("admin.create.nothing.units") };

    const earlier = levelOrder.filter((candidate) => levelRank(candidate) < levelRank(level));
    const previous = await db.grammarUnit.findMany({
      where: { language, level: { in: [...earlier] }, status: { not: "retired" } },
      orderBy: [{ level: "asc" }, { order_no: "asc" }],
      select: { title_fa: true },
    });
    const targets = await appSetting<Record<string, LevelTargets>>(`targets.${language}`);
    const count = targets[level]?.grammar_units ?? 50;
    return {
      params: { level } satisfies UnitListParams,
      values: {
        ...languageValues(language),
        level,
        previous: lines(previous.map((unit) => unit.title_fa)),
        count: String(count),
        prefix: `${language}-${level.toLowerCase()}-`,
        example: example("P-U", language),
      },
      summary: [t("admin.create.summary.units", { level, count })],
      level,
    };
  },

  async importRecords(tx, batch, records) {
    const round = emptyRound();
    const { level } = params<UnitListParams>(batch);
    const prefix = `${batch.language}-${level.toLowerCase()}-`;
    const seen = new Set<string>();

    // Units of this level that the answer does not mention keep their place before the new ones.
    const answerCodes = new Set(
      records.map((record) => labelOf(record, ["unit_code"], -1)).filter((code) => !code.startsWith("#")),
    );
    const others = await tx.grammarUnit.aggregate({
      where: { language: batch.language, level, unit_code: { notIn: [...answerCodes] } },
      _max: { order_no: true },
    });
    let order = others._max.order_no ?? 0;

    for (const [index, record] of records.entries()) {
      const label = labelOf(record, ["unit_code", "title_fa"], index);
      const parsed = unitListItem.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        round.rejected.push({ label, record, problems: zodProblems(parsed.error) });
        continue;
      }
      const unit = parsed.data;
      const problems: Problem[] = [];
      if (!unit.unit_code.startsWith(prefix)) problems.push(problem("unitCodePrefix", { field: "unit_code", prefix }));
      if (unit.level !== level) problems.push(problem("levelMismatch", { value: unit.level, level }));
      if (seen.has(unit.unit_code)) problems.push(problem("repeatedInAnswer", { code: unit.unit_code }));
      const existing = await tx.grammarUnit.findUnique({ where: { unit_code: unit.unit_code } });
      if (existing && !editable.has(existing.status)) problems.push(problem("locked", { code: unit.unit_code }));
      if (problems.length > 0) {
        round.rejected.push({ label, record, problems });
        continue;
      }
      seen.add(unit.unit_code);
      order++;

      const fields = {
        title_fa: unit.title_fa,
        scope_fa: unit.scope_fa,
        can_do_fa: unit.can_do_fa,
        level,
        order_no: order,
        ...trace(batch),
      };
      const saved = existing
        ? await tx.grammarUnit.update({ where: { id: existing.id }, data: fields })
        : await tx.grammarUnit.create({ data: { language: batch.language, unit_code: unit.unit_code, ...fields } });
      if (existing) round.updated++;
      else round.added++;
      round.accepted.push({ label: unit.title_fa, entity: { type: "grammar_unit", id: saved.id }, record });
    }
    return round;
  },
};
