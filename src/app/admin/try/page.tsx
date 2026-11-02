import type { Metadata } from "next";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";
import { SCENARIOS, scenarioSessions } from "@/lib/rehearse";
import { TRAVEL_DAYS } from "@/lib/travel";
import { requireAdmin } from "@/server/auth/session";
import { pickLanguage } from "@/server/content/languages";
import { homeData } from "@/server/learn/home";
import { nextSession, productionOverview, textsOverview } from "@/server/learn/rehearse";
import { rehearseJob } from "@/server/learn/rehearse-jobs";
import { NextList, NowCard, ProductionCard, TextsCard } from "./now";
import { ScenarioPicker, TravelButtons } from "./try-panel";

export const metadata: Metadata = { title: t("admin.rehearse.title") };

/**
 * «آزمایش مثل زبان‌آموز» (DECISIONS.md, 2 November 2026): a teacher turns their own account into a
 * made-up learner, sees what today's session would hold and opens the app to play it.
 */
export default async function TryPage({ searchParams }: PageProps<"/admin/try">) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const language = pickLanguage(query.lang, admin.admin_language);
  const job = rehearseJob(admin.id, language);
  const running = job?.state === "running";
  const [home, next, texts, production] = running
    ? [null, null, null, null]
    : await Promise.all([homeData(admin, language), nextSession(admin, language), textsOverview(admin, language), productionOverview(admin, language)]);

  const scenarios = SCENARIOS.map((scenario) => ({ id: scenario.id, days: scenario.days, sessions: scenarioSessions(scenario) }));
  return (
    <>
      <PageHeader
        title={t("admin.rehearse.title")}
        lead={t("admin.rehearse.lead")}
        actions={admin.admin_language === "all" ? <LanguageTabs current={language} path="/admin/try" /> : null}
      />
      <ScenarioPicker
        language={language}
        scenarios={scenarios}
        minutes={admin.session_length_min}
        job={job ? { scenario: job.scenario, day: job.day, days: job.days, state: job.state, code: job.code, sessions: job.result?.sessions ?? null } : null}
      />
      {running ? null : (
        <>
          <NowCard language={language} home={home} />
          {home ? <NextList language={language} next={next} /> : null}
          {home ? <TextsCard overview={texts} /> : null}
          {home ? <ProductionCard language={language} overview={production} /> : null}
          {home ? <TravelButtons language={language} days={[...TRAVEL_DAYS]} /> : null}
        </>
      )}
    </>
  );
}
