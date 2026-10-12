import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";

/** Sections that are still being built (PRD §16.4 phase 1 lands them one by one). */
export default function SoonPage() {
  return <PageHeader title={t("admin.soon.title")} lead={t("admin.soon.body")} />;
}
