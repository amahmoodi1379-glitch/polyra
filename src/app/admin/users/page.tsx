import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";
import { formatMobileFa } from "@/lib/phone";
import { requireAdmin } from "@/server/auth/session";
import { accountLists, isAdminLanguage, searchAccounts, SEARCH_LIMIT } from "@/server/accounts";
import { AccountList } from "./account-row";
import { NewAccount } from "./new-account";
import { UsersSearch } from "./users-search";

export const metadata: Metadata = { title: t("admin.users.title") };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** «کاربران» (PRD §13.2): find an account by phone; teachers and testers are listed without searching. */
export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const admin = await requireAdmin();
  const q = (one((await searchParams).q) ?? "").trim();
  const now = new Date();

  return (
    <>
      <PageHeader title={t("admin.users.title")} lead={t("admin.users.lead")} />
      <UsersSearch initial={q} />
      {q ? (
        <Results q={q} selfId={admin.id} defaultLanguage={isAdminLanguage(admin.admin_language) ? admin.admin_language : "all"} now={now} />
      ) : (
        <Lists selfId={admin.id} now={now} />
      )}
    </>
  );
}

async function Results({ q, selfId, defaultLanguage, now }: { q: string; selfId: number; defaultLanguage: "fr" | "de" | "all"; now: Date }) {
  const result = await searchAccounts(q);
  if (result.state === "short") return <p className="text-ink-2 text-[14px]">{t("admin.users.short")}</p>;
  if (result.newPhone) return <NewAccount phone={result.newPhone} shown={formatMobileFa(result.newPhone)} defaultLanguage={defaultLanguage} />;
  if (result.rows.length === 0) return <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{t("admin.users.noneFound")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <AccountList id="results" title={t("admin.users.results")} empty="" rows={result.rows} selfId={selfId} now={now} />
      {result.more ? <p className="text-ink-3 text-[13px]">{t("admin.users.more", { count: SEARCH_LIMIT })}</p> : null}
    </div>
  );
}

async function Lists({ selfId, now }: { selfId: number; now: Date }) {
  const lists = await accountLists();
  return (
    <div className="flex flex-col gap-8">
      <AccountList id="admins" title={t("admin.users.lists.admins")} hint={t("admin.users.lists.adminsHint")} empty="" rows={lists.admins} selfId={selfId} now={now} />
      <AccountList
        id="testers"
        title={t("admin.users.lists.testers")}
        hint={t("admin.users.lists.testersHint")}
        empty={t("admin.users.lists.testersNone")}
        rows={lists.testers}
        selfId={selfId}
        now={now}
      />
      <AccountList id="recent" title={t("admin.users.lists.recent")} empty={t("admin.users.lists.recentNone")} rows={lists.recent} selfId={selfId} now={now} />
      <p className="text-ink-3 text-[13px] tabular-nums">{t("admin.users.total", { count: lists.total })}</p>
    </div>
  );
}
