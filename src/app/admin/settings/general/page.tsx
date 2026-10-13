import type { Metadata } from "next";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";
import { requireAdmin } from "@/server/auth/session";
import { pickLanguage } from "@/server/content/languages";
import { generalSettingsView } from "@/server/settings/general";
import { GeneralSettings } from "./general-settings";

export const metadata: Metadata = { title: t("admin.nav.general") };

/** «تنظیمات عمومی» (PRD §13.2): the shared fields, and the chosen language's own. */
export default async function GeneralSettingsPage({ searchParams }: PageProps<"/admin/settings/general">) {
  const admin = await requireAdmin();
  const language = pickLanguage((await searchParams).lang, admin.admin_language);
  const fields = (await generalSettingsView()).filter((field) => field.language === null || field.language === language);
  return (
    <>
      <PageHeader title={t("admin.nav.general")} lead={t("admin.settings.general.lead")} actions={<LanguageTabs current={language} path="/admin/settings/general" />} />
      <GeneralSettings key={language} fields={fields} language={language} />
    </>
  );
}
