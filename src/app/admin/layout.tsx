import type { Metadata } from "next";
import { t } from "@/i18n";
import { formatMobileFa } from "@/lib/phone";
import { requireAdmin } from "@/server/auth/session";
import { getSmsProvider } from "@/server/sms/provider";
import { Wordmark } from "@/components/brand/wordmark";
import { AccountRow, AdminNav, LanguageScope, PanelMark } from "./admin-nav";
import { MobileMenu } from "./mobile-menu";

export const metadata: Metadata = { title: { default: t("admin.panelName"), template: `%s · ${t("admin.panelName")}` } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  const language = admin.admin_language ?? "all";
  const showTestCodes = getSmsProvider().isMock;
  const phone = admin.phone ? formatMobileFa(admin.phone) : "";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="bg-surface border-line sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-e px-4 py-6 lg:flex">
        <PanelMark />
        <LanguageScope current={language} />
        <AdminNav showTestCodes={showTestCodes} />
        <AccountRow phone={phone} />
      </aside>

      <header className="bg-glass border-line sticky top-0 z-30 flex h-16 items-center justify-between border-b px-2 backdrop-blur-md lg:hidden">
        <MobileMenu language={language} showTestCodes={showTestCodes} phone={phone} />
        <Wordmark className="text-[22px]" />
        <span className="size-11" aria-hidden />
      </header>

      <main className="min-w-0 px-5 py-8 lg:px-10 lg:py-10">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8">{children}</div>
      </main>
    </div>
  );
}
