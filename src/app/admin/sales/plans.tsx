"use client";

import { useId, useState, useTransition } from "react";
import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { Toggle } from "@/app/admin/content/[type]/[id]/form-kit";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { savePlanAction, type FormReply } from "./actions";
import { errorText, inputClass, Labeled, NumberInput, ReplyLine, replyErrors } from "./kit";

export type PlanRow = { id: number; name_fa: string; duration_days: number; price_toman: number; badge_fa: string | null; sort_order: number; active: boolean; sold: number };

/** «پلن‌ها» of one language: each plan in a row with «ویرایش», and «پلن تازه» on top (PRD §12.2). */
export function PlansEditor({ language, languageName, plans }: { language: string; languageName: string; plans: PlanRow[] }) {
  const [open, setOpen] = useState<number | "new" | null>(null);
  const nextSort = plans.reduce((max, plan) => Math.max(max, plan.sort_order), 0) + 1;
  return (
    <div className="flex flex-col gap-3">
      {open === "new" ? (
        <PlanForm language={language} title={t("admin.sales.plans.newTitle", { language: languageName })} plan={null} sort={nextSort} onClose={() => setOpen(null)} />
      ) : (
        <Button type="button" variant="secondary" className="w-fit" onClick={() => setOpen("new")} data-add-plan>
          <Plus strokeWidth={2} aria-hidden />
          {t("admin.sales.plans.add")}
        </Button>
      )}
      {plans.length === 0 && open !== "new" ? (
        <p className="border-line-2 text-ink-3 rounded-[18px] border border-dashed px-5 py-4 text-[13.5px] leading-6">{t("admin.sales.plans.none", { language: languageName })}</p>
      ) : null}
      {plans.length > 0 ? (
        <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
          {plans.map((plan) =>
            open === plan.id ? (
              <li key={plan.id}>
                <PlanForm language={language} title={plan.name_fa} plan={plan} sort={plan.sort_order} onClose={() => setOpen(null)} flat />
              </li>
            ) : (
              <li key={plan.id} data-plan-row={plan.name_fa} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-[15.5px] font-extrabold", plan.active ? "text-ink" : "text-ink-3")}>{plan.name_fa}</span>
                    {plan.badge_fa ? <span className="bg-tint text-brand-text rounded-[8px] px-2 py-0.5 text-[12px] font-bold">{plan.badge_fa}</span> : null}
                    {!plan.active ? <span className="bg-line text-ink-2 rounded-[8px] px-2 py-0.5 text-[12px] font-bold">{t("admin.sales.plans.off")}</span> : null}
                  </span>
                  <span className="text-ink-2 flex flex-wrap items-center gap-x-2 text-[13.5px]">
                    <span>{t("admin.sales.days", { n: formatNumber(plan.duration_days) })}</span>
                    <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                    <span className="font-bold">{t("admin.sales.toman", { n: formatNumber(plan.price_toman) })}</span>
                    <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                    <span className="text-ink-3">{t("admin.sales.plans.sold", { n: formatNumber(plan.sold) })}</span>
                  </span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(plan.id)} aria-label={`${t("admin.sales.edit")} ${plan.name_fa}`}>
                  <Pencil strokeWidth={1.75} aria-hidden />
                  {t("admin.sales.edit")}
                </Button>
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}

function PlanForm({ language, title, plan, sort, onClose, flat }: { language: string; title: string; plan: PlanRow | null; sort: number; onClose: () => void; flat?: boolean }) {
  const id = useId();
  const [name, setName] = useState(plan?.name_fa ?? "");
  const [days, setDays] = useState(plan ? String(plan.duration_days) : "30");
  const [price, setPrice] = useState(plan ? String(plan.price_toman) : "");
  const [badge, setBadge] = useState(plan?.badge_fa ?? "");
  const [order, setOrder] = useState(String(sort));
  const [active, setActive] = useState(plan?.active ?? true);
  const [reply, setReply] = useState<FormReply | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = replyErrors(reply);

  const save = () =>
    startTransition(async () => {
      const result = await savePlanAction(plan?.id ?? null, { language, name_fa: name, duration_days: days, price_toman: price, badge_fa: badge, sort_order: order, active });
      setReply(result);
      if (result.ok) onClose();
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      data-plan-form
      className={cn("flex flex-col gap-5 px-5 py-5 sm:px-6", !flat && "bg-surface rounded-[22px] shadow-[var(--shadow-1)]")}
    >
      <h3 className="text-ink text-[16px] font-extrabold">{title}</h3>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <Labeled id={`${id}-name`} label={t("admin.sales.fields.name_fa")} help={t("admin.sales.help.name_fa")} error={errorText(errors, "name_fa")}>
          <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!!errors.name_fa || undefined} className={inputClass} />
        </Labeled>
        <Labeled id={`${id}-badge`} label={t("admin.sales.fields.badge_fa")} help={t("admin.sales.help.badge_fa")} error={errorText(errors, "badge_fa")}>
          <input id={`${id}-badge`} value={badge} onChange={(event) => setBadge(event.target.value)} aria-invalid={!!errors.badge_fa || undefined} className={inputClass} />
        </Labeled>
        <Labeled id={`${id}-days`} label={t("admin.sales.fields.duration_days")} help={t("admin.sales.help.duration_days")} error={errorText(errors, "duration_days")}>
          <NumberInput id={`${id}-days`} value={days} onChange={setDays} invalid={!!errors.duration_days} />
        </Labeled>
        <Labeled id={`${id}-price`} label={t("admin.sales.fields.price_toman")} help={t("admin.sales.help.price_toman")} error={errorText(errors, "price_toman")}>
          <NumberInput id={`${id}-price`} value={price} onChange={setPrice} invalid={!!errors.price_toman} />
        </Labeled>
        <Labeled id={`${id}-sort`} label={t("admin.sales.fields.sort_order")} help={t("admin.sales.help.sort_order")} error={errorText(errors, "sort_order")}>
          <NumberInput id={`${id}-sort`} value={order} onChange={setOrder} invalid={!!errors.sort_order} />
        </Labeled>
        <Labeled id={`${id}-active`} label={t("admin.sales.fields.active")} help={t("admin.sales.help.active")}>
          <Toggle id={`${id}-active`} checked={active} onChange={setActive} label={t("admin.sales.fields.active")} />
        </Labeled>
      </div>
      <ReplyLine reply={reply && !reply.ok ? reply : null} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
          {t("common.save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
