import type { Metadata } from "next";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";
import { requireAdmin } from "@/server/auth/session";
import { codeList, grantPlans, planList } from "@/server/billing/admin";
import { pickLanguage } from "@/server/content/languages";
import { CodesEditor } from "./codes";
import { PlansEditor } from "./plans";

export const metadata: Metadata = { title: t("admin.sales.title") };

const languageName = (language: string) => (language === "fr" || language === "de" ? t(`common.languages.${language}`) : language);

/** «پلن‌ها و کدها» (PRD §12.2, §12.3, §13.2): the plans of one language and every discount code. */
export default async function SalesPage({ searchParams }: PageProps<"/admin/sales">) {
  const admin = await requireAdmin();
  const language = pickLanguage((await searchParams).lang, admin.admin_language);
  const [plans, codes, everyPlan] = await Promise.all([planList(language), codeList(), grantPlans()]);
  const choices = everyPlan.map((plan) => ({ id: plan.id, name: `${plan.name_fa} (${languageName(plan.language)})`, language: plan.language, active: plan.active }));

  return (
    <>
      <PageHeader title={t("admin.sales.title")} lead={t("admin.sales.lead")} />

      <section aria-labelledby="plans" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="plans" className="text-ink text-[19px] font-extrabold">
              {t("admin.sales.plans.title")}
            </h2>
            <p className="text-ink-3 max-w-[62ch] text-[13.5px] leading-6">{t("admin.sales.plans.lead")}</p>
          </div>
          {admin.admin_language === "all" ? <LanguageTabs current={language} path="/admin/sales" /> : null}
        </div>
        <PlansEditor
          key={language}
          language={language}
          languageName={languageName(language)}
          plans={plans.map((plan) => ({
            id: plan.id,
            name_fa: plan.name_fa,
            duration_days: plan.duration_days,
            price_toman: plan.price_toman,
            badge_fa: plan.badge_fa,
            sort_order: plan.sort_order,
            active: plan.active,
            sold: plan.sold,
          }))}
        />
      </section>

      <section id="codes" aria-labelledby="codes-title" className="flex scroll-mt-6 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="codes-title" className="text-ink text-[19px] font-extrabold">
            {t("admin.sales.codes.title")}
          </h2>
          <p className="text-ink-3 max-w-[62ch] text-[13.5px] leading-6">{t("admin.sales.codes.lead")}</p>
        </div>
        <CodesEditor
          now={new Date()}
          plans={choices}
          codes={codes.map((code) => ({
            id: code.id,
            code: code.code,
            type: code.type,
            value: code.value,
            valid_from: code.valid_from,
            valid_to: code.valid_to,
            max_uses_total: code.max_uses_total,
            max_uses_per_user: code.max_uses_per_user,
            plan_ids: code.plan_ids,
            active: code.active,
            used: code.used,
          }))}
        />
      </section>
    </>
  );
}
