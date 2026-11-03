import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { PageBar } from "@/components/learn/page-bar";
import { formatNumber, t } from "@/i18n";
import { formatDateFa, formatDateTimeFa } from "@/lib/format";
import { mySubscription } from "@/server/billing/learner";
import { languageInfo, isLanguage } from "@/server/content/languages";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { FollowUpButton } from "./follow-up";

export const metadata: Metadata = { title: t("learn.subscription.title") };
export const dynamic = "force-dynamic";

const nameOf = (language: string) => (isLanguage(language) ? languageInfo[language].name_fa : language);

/**
 * «اشتراک من» (PRD §12.4 step 7): when each language's access ends, and every order with its date,
 * language, plan, amount and tracking number; «پیگیری پرداخت» beside a recent unpaid one. `?order=`
 * is the order just back from the gateway, said first in plain words.
 */
export default async function SubscriptionPage({ params, searchParams }: PageProps<"/learn/[lang]/subscription">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/subscription`);
  const now = new Date();
  const { languages, orders } = await mySubscription(user.id, now);
  const justId = Number((await searchParams).order);
  const just = Number.isInteger(justId) ? orders.find((order) => order.id === justId) : undefined;
  const staff = user.is_admin || user.is_tester;

  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.subscription.title")} back={`/learn/${language}`} />
        {just ? (
          <div className={just.status === "paid" ? "pay-result ok" : "pay-result bad"} role="status" data-pay-result={just.status}>
            <Icon name={just.status === "paid" ? "l-check" : "l-info"} />
            <p>{just.status === "paid" ? t("learn.subscription.paid", { language: nameOf(just.language) }) : just.status === "pending" ? t("learn.subscription.pending") : t("learn.subscription.failed")}</p>
            {just.status !== "paid" ? (
              <a className="secondary" href={`/learn/${just.language}/plans?plans=1`}>
                {t("learn.subscription.retry")}
              </a>
            ) : null}
          </div>
        ) : null}

        <h2 className="sec-title">{t("learn.subscription.access")}</h2>
        <div className="facts">
          {languages.map((row) => {
            const sub = row.subscriptionEndsAt && row.subscriptionEndsAt > now ? row.subscriptionEndsAt : null;
            const trial = row.trialEndsAt && row.trialEndsAt > now ? row.trialEndsAt : null;
            const text = staff
              ? t("learn.subscription.staff")
              : sub
                ? t("learn.subscription.until", { date: formatDateFa(sub) })
                : !row.trialStarted
                  ? t("learn.subscription.trialNotStarted")
                  : trial
                    ? t("learn.subscription.trialUntil", { date: formatDateTimeFa(trial) })
                    : t("learn.subscription.none");
            return (
              <div className="fact" key={row.language} data-access={row.language}>
                <Icon name="l-cal" />
                <p className="num">
                  <b>{nameOf(row.language)}</b> · {text}
                </p>
                {!staff ? (
                  <a className="ghost" href={`/learn/${row.language}/plans?plans=1`}>
                    {sub ? t("learn.subscription.renew") : t("learn.subscription.buy")}
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>

        <h2 className="sec-title">{t("learn.subscription.orders")}</h2>
        {orders.length === 0 ? (
          <p className="plan-foot">{t("learn.subscription.noOrders")}</p>
        ) : (
          <ul className="orders">
            {orders.map((order) => (
              <li key={order.id} className="order-row" data-order={order.id} data-status={order.status}>
                <div className="order-top">
                  <b>{order.plan ?? t("learn.subscription.planGone")}</b>
                  <span className={`order-status ${order.status}`}>{t(`learn.subscription.status.${order.status}`)}</span>
                </div>
                <p className="num">
                  {nameOf(order.language)} · {formatDateTimeFa(order.createdAt)} · {t("learn.plans.toman", { n: formatNumber(order.amount) })}
                </p>
                {order.ref ? <p className="num">{t("learn.subscription.ref", { ref: order.ref })}</p> : null}
                {order.followUp ? <FollowUpButton orderId={order.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
