import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MonitorSmartphone } from "lucide-react";
import { deviceLabel } from "@/lib/device-label";
import { formatNumber, t } from "@/i18n";
import { formatAgoFa, formatDateFa, formatDateTimeFa } from "@/lib/format";
import { formatMobileFa } from "@/lib/phone";
import { requireAdmin } from "@/server/auth/session";
import { accountDetail, type AccountDetail } from "@/server/accounts";
import { accountSales, grantPlans } from "@/server/billing/admin";
import { languageCodes } from "@/server/content/languages";
import { cn } from "@/lib/utils";
import { AccessChips } from "../account-row";
import { AccessControls } from "./access-controls";
import { SubscriptionTools } from "./subscription-tools";

export const metadata: Metadata = { title: t("admin.users.title") };

const languageName = (language: string) => (language === "fr" || language === "de" ? t(`common.languages.${language}`) : language);

/** One account (PRD §13.2): what it may do, which languages it has started, and where it is signed in. */
export default async function UserPage({ params }: PageProps<"/admin/users/[id]">) {
  const admin = await requireAdmin();
  const id = Number((await params).id);
  const account = Number.isInteger(id) ? await accountDetail(id) : null;
  if (!account) notFound();
  const now = new Date();
  const phone = account.phone ? formatMobileFa(account.phone) : t("admin.users.deletedAccount");
  const self = account.id === admin.id;

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link href="/admin/users" className="text-ink-3 hover:text-ink -ms-1 flex w-fit items-center gap-1 rounded-[10px] py-1 pe-2 text-[13.5px] font-bold transition-colors">
          <ChevronRight className="size-4 ltr:rotate-180" strokeWidth={2} aria-hidden />
          {t("admin.users.detail.back")}
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-ink text-[26px] leading-tight font-extrabold tabular-nums sm:text-[28px]">{phone}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <AccessChips isAdmin={account.isAdmin} adminLanguage={account.adminLanguage} isTester={account.isTester} self={self} />
            <span className="text-ink-3 text-[13px]">{t("admin.users.detail.joined", { date: formatDateFa(account.createdAt) })}</span>
          </div>
        </div>
      </header>

      {account.deleted ? (
        <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-8 text-center shadow-[var(--shadow-1)]">{t("admin.users.detail.deleted")}</p>
      ) : (
        <>
          <section aria-labelledby="access" className="flex flex-col gap-3">
            <h2 id="access" className="text-ink text-[17px] font-extrabold">
              {t("admin.users.detail.access")}
            </h2>
            <div className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
              <AccessControls
                userId={account.id}
                phone={phone}
                self={self}
                initial={{ isAdmin: account.isAdmin, adminLanguage: account.adminLanguage, isTester: account.isTester }}
              />
            </div>
          </section>

          <div className="grid gap-8 md:grid-cols-2 md:gap-6">
            <Languages account={account} now={now} />
            <Devices account={account} now={now} />
          </div>

          <Sales userId={account.id} now={now} />

          <p className="text-ink-3 max-w-[68ch] text-[13px] leading-6">{t("admin.users.detail.later")}</p>
        </>
      )}
    </>
  );
}

function Languages({ account, now }: { account: AccountDetail; now: Date }) {
  return (
    <section aria-labelledby="languages" className="flex flex-col gap-3">
      <h2 id="languages" className="text-ink text-[17px] font-extrabold">
        {t("admin.users.learning.title")}
      </h2>
      {account.languages.length === 0 ? (
        <p className="border-line-2 text-ink-3 rounded-[18px] border border-dashed px-5 py-4 text-[13.5px]">{t("admin.users.learning.none")}</p>
      ) : (
        <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
          {account.languages.map((item) => {
            const subscription = item.subscription;
            const access = subscription
              ? subscription.ends_at > now
                ? t("admin.users.learning.subscriptionUntil", { date: formatDateFa(subscription.ends_at) })
                : t("admin.users.learning.subscriptionEnded", { date: formatDateFa(subscription.ends_at) })
              : !item.trial_ends_at
                ? t("admin.users.learning.trialNotStarted")
                : item.trial_ends_at > now
                  ? t("admin.users.learning.trialUntil", { date: formatDateFa(item.trial_ends_at) })
                  : t("admin.users.learning.trialEnded");
            return (
              <li key={item.language} className="flex flex-col gap-2 px-5 py-4 sm:px-6">
                <p className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="text-ink text-[15.5px] font-extrabold">{languageName(item.language)}</span>
                  <span className="text-ink-3 text-[12.5px]">{t("admin.users.learning.started", { date: formatDateFa(item.created_at) })}</span>
                </p>
                <p className="text-ink-2 text-[13.5px]">{access}</p>
                {item.skills.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {item.skills.map((skill) => (
                      <li key={skill.skill} className="bg-tint text-ink flex h-7 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-bold">
                        {t(`admin.users.learning.skills.${skill.skill}`)}
                        <bdi className="lat text-brand-text text-[13px] font-semibold">{skill.level}</bdi>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-3 text-[12.5px]">{t("admin.users.learning.skillsNone")}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Devices({ account, now }: { account: AccountDetail; now: Date }) {
  return (
    <section aria-labelledby="devices" className="flex flex-col gap-3">
      <h2 id="devices" className="text-ink text-[17px] font-extrabold">
        {t("admin.users.devices.title")}
      </h2>
      {account.devices.length === 0 ? (
        <p className="border-line-2 text-ink-3 rounded-[18px] border border-dashed px-5 py-4 text-[13.5px]">{t("admin.users.devices.none")}</p>
      ) : (
        <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
          {account.devices.map((device) => {
            const label = deviceLabel(device.user_agent);
            return (
              <li key={device.id} className="flex items-center gap-3.5 px-5 py-3.5 sm:px-6">
                <MonitorSmartphone className="text-ink-3 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  {label ? (
                    <bdi dir="ltr" className="text-ink w-fit text-[14.5px] font-bold">
                      {label}
                    </bdi>
                  ) : (
                    <span className="text-ink text-[14.5px] font-bold">{t("admin.users.devices.unknown")}</span>
                  )}
                  <span className="text-ink-3 flex flex-wrap items-center gap-x-2 text-[12.5px]">
                    <span>{t("admin.users.devices.seen", { when: formatAgoFa(device.last_seen_at, now) })}</span>
                    <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                    <span>{t("admin.users.devices.since", { date: formatDateFa(device.created_at) })}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const orderLook = { paid: "bg-ok-soft text-ok", pending: "bg-tint text-brand-text", failed: "bg-bad-soft text-bad", expired: "bg-line text-ink-2" } as const;

/** «اشتراک و خریدها»: every subscription row, the grant and shorten tools, and the account's orders (PRD §12.3). */
async function Sales({ userId, now }: { userId: number; now: Date }) {
  const [{ subscriptions, orders }, plans] = await Promise.all([accountSales(userId), grantPlans()]);
  const active = [...new Set(subscriptions.filter((row) => row.ends_at > now).map((row) => row.language))];
  return (
    <section aria-labelledby="sales" className="flex flex-col gap-4">
      <h2 id="sales" className="text-ink text-[17px] font-extrabold">
        {t("admin.users.sales.title")}
      </h2>
      <div className="grid gap-8 md:grid-cols-2 md:gap-6">
        <div className="flex flex-col gap-3">
          <h3 className="text-ink-2 text-[14px] font-bold">{t("admin.users.sales.subscriptions")}</h3>
          {subscriptions.length === 0 ? (
            <p className="border-line-2 text-ink-3 rounded-[18px] border border-dashed px-5 py-4 text-[13.5px]">{t("admin.users.sales.noSubscriptions")}</p>
          ) : (
            <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]" data-subscriptions>
              {subscriptions.map((row) => (
                <li key={row.id} data-subscription={row.language} className={cn("flex flex-col gap-1 px-5 py-3.5 sm:px-6", row.ends_at <= now && "opacity-70")}>
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-ink text-[14.5px] font-extrabold">{languageName(row.language)}</span>
                    <span className="text-ink-2 text-[13px] font-bold">{row.plan ?? t(`admin.users.sales.source.${row.source}`)}</span>
                    {row.plan ? <span className="text-ink-3 text-[12.5px]">{t(`admin.users.sales.source.${row.source}`)}</span> : null}
                  </p>
                  <p className="text-ink-2 text-[13px] tabular-nums">{t("admin.users.sales.range", { start: formatDateFa(row.starts_at), end: formatDateFa(row.ends_at) })}</p>
                  {row.note || row.grantedByPhone ? (
                    <p className="text-ink-3 text-[12.5px] leading-6">
                      {row.grantedByPhone ? t("admin.users.sales.by", { who: formatMobileFa(row.grantedByPhone) }) : null}
                      {row.grantedByPhone && row.note ? " · " : null}
                      {row.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-ink-2 text-[14px] font-bold">{t("admin.users.sales.orders")}</h3>
          {orders.length === 0 ? (
            <p className="border-line-2 text-ink-3 rounded-[18px] border border-dashed px-5 py-4 text-[13.5px]">{t("admin.users.sales.noOrders")}</p>
          ) : (
            <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
              {orders.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 sm:px-6">
                  <span className={cn("rounded-[8px] px-2 py-0.5 text-[12px] font-bold", orderLook[order.status])}>{t(`learn.subscription.status.${order.status}`)}</span>
                  <span className="text-ink text-[14px] font-bold">{order.plan ?? t("admin.orders.planGone")}</span>
                  <span className="text-ink-3 text-[12.5px] tabular-nums">{formatDateTimeFa(order.created_at)}</span>
                  <span className="text-ink ms-auto text-[14px] font-bold">
                    {order.final_amount === 0 ? t("admin.orders.free") : t("admin.sales.toman", { n: formatNumber(order.final_amount) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <SubscriptionTools
        userId={userId}
        languages={[...languageCodes]}
        active={active}
        plans={plans.map((plan) => ({ id: plan.id, language: plan.language, name: plan.name_fa, days: plan.duration_days, active: plan.active }))}
      />
    </section>
  );
}
