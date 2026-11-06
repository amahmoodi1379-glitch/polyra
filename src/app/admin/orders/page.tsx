import type { Metadata } from "next";
import Link from "@/components/admin/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { formatNumber, t, tRich } from "@/i18n";
import { formatDateTimeFa } from "@/lib/format";
import { formatMobileFa } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { orderList, type OrderFilter } from "@/server/billing/admin";
import { isLanguage } from "@/server/content/languages";
import { RecheckButton } from "./recheck";

export const metadata: Metadata = { title: t("admin.orders.title") };

const statuses = ["pending", "paid", "failed", "expired"] as const;
type Status = (typeof statuses)[number];
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const languageName = (language: string) => (language === "fr" || language === "de" ? t(`common.languages.${language}`) : language);

function ordersHref(status: Status | null, page = 1) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/orders?${query}` : "/admin/orders";
}

const statusLook: Record<Status, string> = {
  paid: "bg-ok-soft text-ok",
  pending: "bg-tint text-brand-text",
  failed: "bg-bad-soft text-bad",
  expired: "bg-line text-ink-2",
};

/** «سفارش‌ها» (PRD §12.4, §13.2): every order, newest first, with «استعلام دوباره» on the ones not paid. */
export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const asked = one(query.status);
  const status = statuses.includes(asked as Status) ? (asked as Status) : null;
  const filter: OrderFilter = { status: status ?? undefined, language: isLanguage(admin.admin_language ?? "") ? admin.admin_language : null, page: Number(one(query.page)) || 1 };
  const data = await orderList(filter);

  return (
    <>
      <PageHeader title={t("admin.orders.title")} lead={t("admin.orders.lead")} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label={t("admin.orders.statusLabel")} className="-mx-5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0">
            <ul className="flex w-max gap-1.5">
              {[null, ...statuses].map((item) => (
                <li key={item ?? "all"}>
                  <Link
                    href={ordersHref(item)}
                    scroll={false}
                    aria-current={item === status ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center rounded-[12px] px-3.5 text-[13.5px] font-bold whitespace-nowrap transition-[background-color,color] duration-150",
                      item === status ? "bg-tint text-brand-text" : "bg-surface text-ink-2 hover:text-ink shadow-[var(--shadow-1)]",
                    )}
                  >
                    {item ? t(`learn.subscription.status.${item}`) : t("admin.orders.all")}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <span className="text-ink-3 text-[13px]">{t("admin.orders.count", { n: formatNumber(data.total) })}</span>
        </div>

        {data.rows.length === 0 ? (
          <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{t("admin.orders.none")}</p>
        ) : (
          <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
            {data.rows.map((order) => (
              <li key={order.id} data-order-row={order.id} data-status={order.status} className="flex flex-col gap-2 px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className={cn("rounded-[8px] px-2 py-0.5 text-[12.5px] font-bold", statusLook[order.status])}>{t(`learn.subscription.status.${order.status}`)}</span>
                  <span className="text-ink text-[15px] font-extrabold">{order.plan ?? t("admin.orders.planGone")}</span>
                  <span className="text-ink-3 text-[13px]">{languageName(order.language)}</span>
                  <span className="text-ink ms-auto text-[15px] font-extrabold">
                    {order.final_amount === 0 ? t("admin.orders.free") : t("admin.sales.toman", { n: formatNumber(order.final_amount) })}
                  </span>
                </div>
                <div className="text-ink-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="tabular-nums">{formatDateTimeFa(order.created_at)}</span>
                  <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                  {order.phone ? (
                    <Link href={`/admin/users/${order.user_id}`} className="text-brand-text font-bold tabular-nums hover:underline">
                      {formatMobileFa(order.phone)}
                    </Link>
                  ) : (
                    <span>{t("admin.users.deletedAccount")}</span>
                  )}
                  {order.code ? (
                    <>
                      <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                      <span>
                        {tRich("admin.orders.code", {
                          code: (
                            <bdi key="code" dir="ltr" className="lat font-semibold">
                              {order.code}
                            </bdi>
                          ),
                        })}
                        {" · "}
                        {t("admin.orders.full", { n: formatNumber(order.amount_toman) })}
                      </span>
                    </>
                  ) : null}
                  {order.gateway_ref ? (
                    <>
                      <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                      <span>
                        {tRich("admin.orders.ref", {
                          ref: (
                            <bdi key="ref" dir="ltr" className="num">
                              {order.gateway_ref}
                            </bdi>
                          ),
                        })}
                      </span>
                    </>
                  ) : null}
                  {order.gateway === "mock" ? (
                    <>
                      <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                      <span className="text-ink-3">{t("admin.orders.mock")}</span>
                    </>
                  ) : null}
                </div>
                {order.status !== "paid" && order.authority ? <RecheckButton orderId={order.id} /> : null}
              </li>
            ))}
          </ul>
        )}

        {data.pages > 1 ? (
          <nav className="flex items-center justify-center gap-3">
            <Button asChild variant="secondary" size="sm" className={cn(data.page <= 1 && "pointer-events-none opacity-40")}>
              <Link href={ordersHref(status, data.page - 1)} aria-disabled={data.page <= 1}>
                <ChevronRight className="ltr:rotate-180" strokeWidth={2} aria-hidden />
                {t("admin.orders.prev")}
              </Link>
            </Button>
            <span className="text-ink-3 text-[13px] tabular-nums">{t("admin.orders.page", { page: formatNumber(data.page), pages: formatNumber(data.pages) })}</span>
            <Button asChild variant="secondary" size="sm" className={cn(data.page >= data.pages && "pointer-events-none opacity-40")}>
              <Link href={ordersHref(status, data.page + 1)} aria-disabled={data.page >= data.pages}>
                {t("admin.orders.next")}
                <ChevronLeft className="ltr:rotate-180" strokeWidth={2} aria-hidden />
              </Link>
            </Button>
          </nav>
        ) : null}
      </div>
    </>
  );
}
