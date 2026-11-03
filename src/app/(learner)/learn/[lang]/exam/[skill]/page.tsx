import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { num } from "@/engine/settings";
import type { SkillName } from "@/engine/state";
import { t } from "@/i18n";
import { languageInfo } from "@/server/content/languages";
import { EXAM_SKILLS, examScreen, examTiles } from "@/server/learn/exam";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { learnContext } from "@/server/learn/session";
import { ExamFlow } from "./exam-flow";

export const metadata: Metadata = { title: t("learn.exam.title") };

/** «پرش از این سطح» (PRD §11.6): what the exam asks and «شروع آزمون», then one question or text at a time, then the result. */
export default async function ExamPage({ params }: PageProps<"/learn/[lang]/exam/[skill]">) {
  const { lang, skill: raw } = await params;
  const language = languageParam(lang);
  if (!language || !(EXAM_SKILLS as readonly string[]).includes(raw)) notFound();
  const skill = raw as SkillName;
  const user = await requireLearner(`/learn/${language}/exam/${skill}`);
  const screen = await examScreen(user, language, skill);
  const ctx = await learnContext(user, language, new Date());
  const rules = {
    size: num(ctx.settings, "exam.size"),
    pass: num(ctx.settings, "exam.pass_min"),
    percent: Math.round(num(ctx.settings, "exam.text_pass") * 100),
    days: num(ctx.settings, "exam.cooldown_days"),
  };
  if (screen) return <ExamFlow language={language} languageName={languageInfo[language].name_fa} skill={skill} initial={screen} offer={null} rules={rules} />;
  const tile = (await examTiles(user, language, ctx))[skill];
  if (tile.offer.kind !== "ready") redirect(`/learn/${language}`);
  return <ExamFlow language={language} languageName={languageInfo[language].name_fa} skill={skill} initial={null} offer={{ level: tile.offer.level, next: tile.offer.next }} rules={rules} />;
}
