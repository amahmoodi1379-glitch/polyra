import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { pickLanguage } from "@/server/content/languages";
import { isOrderList, loadOrder, orderLists, perLevel, type OrderList } from "@/server/content/order";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { OrderBoard } from "./order-board";

export const metadata: Metadata = { title: t("admin.order.title") };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function orderHref(language: string, list: OrderList, level?: string | null) {
  const params = new URLSearchParams({ lang: language, list });
  if (level && perLevel[list]) params.set("level", level);
  return `/admin/order?${params}`;
}

/** How many items each level of a list has, for the level chips. */
async function levelCounts(list: OrderList, language: string): Promise<Record<string, number>> {
  const where = { language, status: { not: "retired" as const } };
  const rows =
    list === "words"
      ? await db.word.groupBy({ by: ["level"], where, _count: true })
      : list === "units"
        ? await db.grammarUnit.groupBy({ by: ["level"], where, _count: true })
        : list === "texts"
          ? await db.text.groupBy({ by: ["level"], where, _count: true })
          : [];
  return Object.fromEntries(rows.map((row) => [row.level, row._count]));
}

/**
 * «ترتیب» (PRD §13.2, §13.6): the order learners meet words, grammar units, phonics lessons and
 * texts. One list at a time; lists per level show one level.
 */
export default async function OrderPage({ searchParams }: PageProps<"/admin/order">) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const language = pickLanguage(query.lang, admin.admin_language);
  const list: OrderList = isOrderList(one(query.list)) ? (one(query.list) as OrderList) : "words";
  const levels = await appSetting<string[]>(`levels.${language}`);
  const counts = await levelCounts(list, language);
  const asked = one(query.level);
  const level = perLevel[list] ? (asked && levels.includes(asked) ? asked : (levels.find((item) => counts[item]) ?? levels[0])) : null;
  const view = await loadOrder(list, language, level);

  return (
    <>
      <PageHeader title={t("admin.order.title")} lead={t("admin.order.lead")} actions={<LanguageTabs current={language} path={`/admin/order?list=${list}`} />} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <nav aria-label={t("admin.order.listsLabel")} className="bg-tint grid w-full grid-cols-2 gap-1 rounded-[16px] p-1 sm:flex sm:w-auto">
            {orderLists.map((item) => (
              <Link
                key={item}
                href={orderHref(language, item)}
                scroll={false}
                aria-current={item === list ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center justify-center rounded-[12px] px-4 text-[13.5px] font-bold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
                  item === list ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
                )}
              >
                {t(`admin.order.lists.${item}`)}
              </Link>
            ))}
          </nav>
          {level ? (
            <nav aria-label={t("admin.order.levelsLabel")} className="bg-tint flex gap-1 rounded-[14px] p-1">
              {levels.map((item) => (
                <Link
                  key={item}
                  href={orderHref(language, list, item)}
                  scroll={false}
                  aria-current={item === level ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-bold transition-[background-color,color,box-shadow] duration-150",
                    item === level ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
                  )}
                >
                  <bdi className="lat text-[14px] font-semibold">{item}</bdi>
                  <span className={cn("text-[12px] font-medium tabular-nums", item === level ? "text-brand-text/75" : "text-ink-3")}>{formatNumber(counts[item] ?? 0)}</span>
                </Link>
              ))}
            </nav>
          ) : null}
        </div>

        <p className="text-ink-2 flex max-w-[72ch] items-start gap-2 text-[13.5px] leading-6">
          <Info className="text-ink-3 mt-1 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            {t(`admin.order.effect.${list}`)}
            {level ? ` ${t("admin.order.levelHint")}` : null}
          </span>
        </p>

        <OrderBoard key={`${list}-${language}-${level}`} view={view} />
      </div>
    </>
  );
}
