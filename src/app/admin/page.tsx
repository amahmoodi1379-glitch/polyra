import Link from "next/link";
import { ClipboardPaste } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export default function WorkbenchPage() {
  return (
    <>
      <PageHeader title={t("admin.workbench.title")} lead={t("admin.workbench.lead")} />
      <section className="bg-surface border-line flex flex-col items-start gap-4 rounded-[22px] border p-6 shadow-[var(--shadow-1)] sm:p-8">
        <h2 className="text-ink text-lg font-extrabold">{t("admin.workbench.emptyTitle")}</h2>
        <p className="text-ink-2 max-w-[60ch]">{t("admin.workbench.emptyBody")}</p>
        <Button asChild>
          <Link href="/admin/create">
            <ClipboardPaste strokeWidth={1.75} aria-hidden />
            {t("admin.workbench.emptyAction")}
          </Link>
        </Button>
      </section>
    </>
  );
}
