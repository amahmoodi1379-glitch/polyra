import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { t } from "@/i18n";
import { formatAgoFa, formatDateFa } from "@/lib/format";
import { formatMobileFa } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { AccountRow, AdminLanguage } from "@/server/accounts";

export const languageLabel = (language: AdminLanguage | null) => (language === "fr" || language === "de" ? t(`common.languages.${language}`) : t("admin.users.languages.all"));

const chip = "flex h-6 items-center rounded-[8px] px-2 text-[12px] font-bold whitespace-nowrap";

/** Teacher, tester and «خودت» as small labels next to a phone. */
export function AccessChips({ isAdmin, adminLanguage, isTester, self }: { isAdmin: boolean; adminLanguage: AdminLanguage | null; isTester: boolean; self: boolean }) {
  return (
    <>
      {isAdmin ? (
        <span className={cn(chip, "bg-tint text-brand-text gap-1.5")}>
          {t("admin.users.row.admin")}
          <span className="bg-brand-text/45 size-1 rounded-full" aria-hidden />
          <span className="font-semibold">{languageLabel(adminLanguage)}</span>
        </span>
      ) : null}
      {isTester ? <span className={cn(chip, "bg-tint-2 text-ink")}>{t("admin.users.row.tester")}</span> : null}
      {self ? <span className={cn(chip, "border-line-2 text-ink-3 border")}>{t("admin.users.row.you")}</span> : null}
    </>
  );
}

/** One account in a list: its number, what it may do, since when, and whether it is signed in. */
export function AccountRowView({ row, selfId, now }: { row: AccountRow; selfId: number; now: Date }) {
  const phone = formatMobileFa(row.phone);
  return (
    <li>
      <Link
        href={`/admin/users/${row.id}`}
        aria-label={t("admin.users.row.open", { phone })}
        className="hover:bg-tint/50 focus-visible:bg-tint/50 group flex items-center gap-4 px-5 py-3.5 transition-colors outline-none sm:px-6"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="text-ink text-[16px] font-extrabold tabular-nums">{phone}</span>
            <AccessChips isAdmin={row.isAdmin} adminLanguage={row.adminLanguage} isTester={row.isTester} self={row.id === selfId} />
          </span>
          <span className="text-ink-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
            <span>{t("admin.users.row.since", { date: formatDateFa(row.createdAt) })}</span>
            <span className="bg-line-2 size-1 rounded-full" aria-hidden />
            <span>
              {row.devices > 0 && row.lastSeen
                ? `${t("admin.users.row.devices", { count: row.devices })}، ${t("admin.users.devices.seen", { when: formatAgoFa(row.lastSeen, now) })}`
                : t("admin.users.row.noDevice")}
            </span>
            {row.languages.length > 0 ? (
              <>
                <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                <span>{row.languages.map((language) => (language === "fr" || language === "de" ? t(`common.languages.${language}`) : language)).join("، ")}</span>
              </>
            ) : null}
          </span>
        </span>
        <ChevronLeft
          className="text-ink-3 group-hover:text-ink size-5 shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5 ltr:rotate-180 ltr:group-hover:translate-x-0.5"
          strokeWidth={2}
          aria-hidden
        />
      </Link>
    </li>
  );
}

/** A titled card of accounts, or one quiet line when it has none. */
export function AccountList({
  id,
  title,
  hint,
  empty,
  rows,
  selfId,
  now,
}: {
  id: string;
  title: string;
  hint?: string;
  empty: string;
  rows: AccountRow[];
  selfId: number;
  now: Date;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id={id} className="text-ink text-[17px] font-extrabold">
          {title}
          {rows.length > 0 ? <span className="text-ink-3 ms-2 text-[13px] font-bold tabular-nums">{t("admin.users.found", { count: rows.length })}</span> : null}
        </h2>
        {hint ? <p className="text-ink-3 text-[13px]">{hint}</p> : null}
      </div>
      {rows.length > 0 ? (
        <ul className="bg-surface divide-line flex flex-col divide-y overflow-hidden rounded-[22px] shadow-[var(--shadow-1)]">
          {rows.map((row) => (
            <AccountRowView key={row.id} row={row} selfId={selfId} now={now} />
          ))}
        </ul>
      ) : (
        <p className="border-line-2 text-ink-3 rounded-[18px] border border-dashed px-5 py-4 text-[13.5px]">{empty}</p>
      )}
    </section>
  );
}
