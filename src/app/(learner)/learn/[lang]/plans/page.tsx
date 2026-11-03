import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { PageBar } from "@/components/learn/page-bar";
import { t } from "@/i18n";
import { activePlans, gatewayIsMock, planView } from "@/server/billing/learner";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { homeData } from "@/server/learn/home";
import { PlanPicker } from "./plan-picker";

export const metadata: Metadata = { title: t("learn.plans.title") };
export const dynamic = "force-dynamic";

/**
 * The lock page and the plans (PRD §3.8, §12.2, §12.4): when the language is locked, what was learned
 * so far and what waits first, then «ادامه می‌دهم» to the plans; otherwise the plans straight away.
 * `?plans=1` is the plans after «ادامه می‌دهم».
 */
export default async function PlansPage({ params, searchParams }: PageProps<"/learn/[lang]/plans">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/plans`);
  const home = await homeData(user, language);
  if (!home) redirect(`/start/${language}`);
  const showPlans = !home.lockSummary || (await searchParams).plans === "1";
  const summary = home.lockSummary;

  if (summary && !showPlans) {
    const lines: { icon: "i-vocab" | "l-cal" | "l-chain"; text: string; key: string }[] = [];
    if (summary.words > 0 || summary.units > 0) {
      const parts = [summary.words > 0 ? t("learn.lock.words", { n: summary.words }) : null, summary.units > 0 ? t("learn.lock.units", { n: summary.units }) : null].filter(Boolean);
      lines.push({ key: "learned", icon: "i-vocab", text: t("learn.lock.learned", { parts: parts.join(t("learn.home.and")) }) });
    }
    if (summary.reviews > 0) lines.push({ key: "reviews", icon: "l-cal", text: t("learn.lock.reviews", { n: summary.reviews }) });
    if (summary.streak) {
      lines.push({
        key: "streak",
        icon: "l-chain",
        text: summary.streak.today ? t("learn.lock.streakTonight", { n: summary.streak.count }) : t("learn.lock.streakUntil", { n: summary.streak.count, day: summary.streak.until }),
      });
    }
    return (
      <main className="app">
        <div className="screen">
          <PageBar title={t("learn.lock.title")} back={`/learn/${language}`} />
          <header className="lock-head" data-lock-page>
            <span className="mark">
              <Icon name="l-lock" />
            </span>
            <h2>{t("learn.lock.heading")}</h2>
            <p>{t("learn.lock.lead")}</p>
          </header>
          {lines.length > 0 ? (
            <div className="facts">
              {lines.map((line) => (
                <div className={line.key === "streak" ? "fact str" : "fact"} key={line.key}>
                  <Icon name={line.icon} />
                  <p className="num">{line.text}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="cta">
            <a className="primary jelly-press" href={`/learn/${language}/plans?plans=1`}>
              {t("learn.lock.continue")}
            </a>
          </div>
        </div>
      </main>
    );
  }

  const [plans] = await Promise.all([activePlans(language), planView(user.id, language, !!summary)]);
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.plans.title")} back={`/learn/${language}`} />
        <p className="plan-note" role="note">
          {t("learn.plans.vpn")}
        </p>
        {gatewayIsMock() ? <p className="plan-note mock">{t("learn.plans.mock")}</p> : null}
        {plans.length === 0 ? (
          <div className="empty">
            <Icon name="l-cal" />
            <p>{t("learn.plans.none")}</p>
          </div>
        ) : (
          <PlanPicker plans={plans} />
        )}
        <p className="plan-foot">{t("learn.plans.rule")}</p>
        <a className="ghost" href={`/learn/${language}/subscription`}>
          {t("learn.plans.mine")}
        </a>
      </div>
    </main>
  );
}
