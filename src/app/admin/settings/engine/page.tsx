import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";
import { requireAdmin } from "@/server/auth/session";
import { engineSettingsView } from "@/server/settings/engine";
import { EngineSettings } from "./engine-settings";

export const metadata: Metadata = { title: t("admin.nav.engine") };

/** «تنظیمات موتور» (PRD §9.8, §13.2). */
export default async function EngineSettingsPage() {
  await requireAdmin();
  const groups = await engineSettingsView();
  return (
    <>
      <PageHeader title={t("admin.nav.engine")} lead={t("admin.settings.engine.lead")} />
      <EngineSettings groups={groups} />
    </>
  );
}
