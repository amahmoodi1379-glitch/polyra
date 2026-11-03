"use client";

import { useId, useState, useTransition } from "react";
import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { Segmented, Toggle } from "@/app/admin/content/[type]/[id]/form-kit";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { formatDateFa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveCodeAction, type FormReply } from "./actions";
import { errorText, inputClass, Labeled, NumberInput, ReplyLine, replyErrors } from "./kit";

export type CodeRow = {
  id: number;
  code: string;
  type: "percent" | "amount";
  value: number;
  valid_from: Date | null;
  valid_to: Date | null;
  max_uses_total: number | null;
  max_uses_per_user: number;
  plan_ids: number[];
  active: boolean;
  used: number;
};
export type PlanChoice = { id: number; name: string; language: string; active: boolean };

const valueText = (code: Pick<CodeRow, "type" | "value">) =>
  code.type === "percent" ? t("admin.sales.percent", { n: formatNumber(code.value) }) : t("admin.sales.toman", { n: formatNumber(code.value) });

/** «کدهای تخفیف» (PRD §12.3): every code with its use, and a form to add or change one. */
export function CodesEditor({ codes, plans, now }: { codes: CodeRow[]; plans: PlanChoice[]; now: Date }) {
  const [open, setOpen] = useState<number | "new" | null>(null);
  const planName = new Map(plans.map((plan) => [plan.id, plan.name]));
  return (
    <div className="flex flex-col gap-3">
      {open === "new" ? (
        <CodeForm code={null} plans={plans} onClose={() => setOpen(null)} />
      ) : (
        <Button type="button" variant="secondary" className="w-fit" onClick={() => setOpen("new")} data-add-code>
          <Plus strokeWidth={2} aria-hidden />
          {t("admin.sales.codes.add")}
        </Button>
      )}
      {codes.length === 0 && open !== "new" ? <p className="border-line-2 text-ink-3 rounded-[18px] border border-dashed px-5 py-4 text-[13.5px]">{t("admin.sales.codes.none")}</p> : null}
      {codes.length > 0 ? (
        <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
          {codes.map((code) => {
            if (open === code.id)
              return (
                <li key={code.id}>
                  <CodeForm code={code} plans={plans} onClose={() => setOpen(null)} flat />
                </li>
              );
            const ended = code.valid_to !== null && code.valid_to <= now;
            const full = code.max_uses_total !== null && code.used >= code.max_uses_total;
            const dim = !code.active || ended || full;
            return (
              <li key={code.id} data-code-row={code.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <bdi dir="ltr" className={cn("lat text-[16px] font-semibold tracking-wide", dim ? "text-ink-3" : "text-ink")}>
                      {code.code}
                    </bdi>
                    <span className="bg-tint text-brand-text rounded-[8px] px-2 py-0.5 text-[12.5px] font-bold">{valueText(code)}</span>
                    {!code.active ? <Chip>{t("admin.sales.codes.off")}</Chip> : ended ? <Chip>{t("admin.sales.codes.ended")}</Chip> : full ? <Chip>{t("admin.sales.codes.full")}</Chip> : null}
                  </span>
                  <span className="text-ink-2 flex flex-wrap items-center gap-x-2 text-[13px]">
                    <span>{code.valid_to ? t("admin.sales.codes.until", { date: formatDateFa(code.valid_to) }) : t("admin.sales.codes.noEnd")}</span>
                    <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                    <span>
                      {code.max_uses_total !== null
                        ? t("admin.sales.codes.usedOf", { n: formatNumber(code.used), max: formatNumber(code.max_uses_total) })
                        : t("admin.sales.codes.used", { n: formatNumber(code.used) })}
                    </span>
                    <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                    <span>{code.plan_ids.length === 0 ? t("admin.sales.codes.allPlans") : code.plan_ids.map((id) => planName.get(id) ?? `#${id}`).join("، ")}</span>
                  </span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(code.id)} aria-label={`${t("admin.sales.edit")} ${code.code}`}>
                  <Pencil strokeWidth={1.75} aria-hidden />
                  {t("admin.sales.edit")}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="bg-line text-ink-2 rounded-[8px] px-2 py-0.5 text-[12px] font-bold">{children}</span>;
}

function CodeForm({ code, plans, onClose, flat }: { code: CodeRow | null; plans: PlanChoice[]; onClose: () => void; flat?: boolean }) {
  const id = useId();
  const [text, setText] = useState(code?.code ?? "");
  const [type, setType] = useState<"percent" | "amount">(code?.type ?? "percent");
  const [value, setValue] = useState(code ? String(code.value) : "");
  // Any end it has stays unless switched off, a past one too: saving an ended code must not bring it back.
  const hasEnd = code?.valid_to != null;
  const [keepEnd, setKeepEnd] = useState(hasEnd);
  const [days, setDays] = useState("");
  const [total, setTotal] = useState(code?.max_uses_total != null ? String(code.max_uses_total) : "");
  const [perUser, setPerUser] = useState(code ? String(code.max_uses_per_user) : "1");
  const [planIds, setPlanIds] = useState<number[]>(code?.plan_ids ?? []);
  const [active, setActive] = useState(code?.active ?? true);
  const [reply, setReply] = useState<FormReply | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = replyErrors(reply);

  const save = () =>
    startTransition(async () => {
      const result = await saveCodeAction(code?.id ?? null, {
        code: text,
        type,
        value,
        valid_from: code?.valid_from ? code.valid_from.toISOString() : null,
        valid_to: keepEnd && code?.valid_to ? code.valid_to.toISOString() : null,
        keep_end: keepEnd && hasEnd,
        valid_days: keepEnd && hasEnd ? undefined : days,
        max_uses_total: total,
        max_uses_per_user: perUser,
        plan_ids: planIds,
        active,
      });
      setReply(result);
      if (result.ok) onClose();
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      data-code-form
      className={cn("flex flex-col gap-5 px-5 py-5 sm:px-6", !flat && "bg-surface rounded-[22px] shadow-[var(--shadow-1)]")}
    >
      <h3 className="text-ink text-[16px] font-extrabold">{code ? <bdi className="lat">{code.code}</bdi> : t("admin.sales.codes.newTitle")}</h3>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <Labeled id={`${id}-code`} label={t("admin.sales.fields.code")} help={t("admin.sales.help.code")} error={errorText(errors, "code")}>
          <input
            id={`${id}-code`}
            dir="ltr"
            autoCapitalize="characters"
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-invalid={!!errors.code || undefined}
            className={cn(inputClass, "lat text-[16px] tracking-wide uppercase")}
          />
        </Labeled>
        <Labeled label={t("admin.sales.fields.type")} error={errorText(errors, "type")}>
          <Segmented
            value={type}
            onChange={(next) => setType(next as "percent" | "amount")}
            label={t("admin.sales.fields.type")}
            options={[
              { value: "percent", label: t("admin.sales.codes.types.percent") },
              { value: "amount", label: t("admin.sales.codes.types.amount") },
            ]}
          />
        </Labeled>
        <Labeled
          id={`${id}-value`}
          label={t("admin.sales.fields.value")}
          help={t(type === "percent" ? "admin.sales.help.value_percent" : "admin.sales.help.value_amount")}
          error={errorText(errors, "value")}
        >
          <NumberInput id={`${id}-value`} value={value} onChange={setValue} invalid={!!errors.value} />
        </Labeled>
        <Labeled id={`${id}-days`} label={t("admin.sales.codes.validDays")} help={t("admin.sales.help.valid_days")} error={errorText(errors, "valid_to")}>
          {hasEnd ? (
            <label className="text-ink-2 flex items-center gap-3 text-[13.5px]">
              <Toggle checked={keepEnd} onChange={setKeepEnd} label={t("admin.sales.codes.keepEnd", { date: formatDateFa(code!.valid_to!) })} />
              {t("admin.sales.codes.keepEnd", { date: formatDateFa(code!.valid_to!) })}
            </label>
          ) : null}
          {!(hasEnd && keepEnd) ? <NumberInput id={`${id}-days`} value={days} onChange={setDays} invalid={!!errors.valid_to} /> : null}
        </Labeled>
        <Labeled id={`${id}-total`} label={t("admin.sales.fields.max_uses_total")} help={t("admin.sales.help.max_uses_total")} error={errorText(errors, "max_uses_total")}>
          <NumberInput id={`${id}-total`} value={total} onChange={setTotal} invalid={!!errors.max_uses_total} />
        </Labeled>
        <Labeled id={`${id}-per`} label={t("admin.sales.fields.max_uses_per_user")} help={t("admin.sales.help.max_uses_per_user")} error={errorText(errors, "max_uses_per_user")}>
          <NumberInput id={`${id}-per`} value={perUser} onChange={setPerUser} invalid={!!errors.max_uses_per_user} />
        </Labeled>
        <Labeled label={t("admin.sales.fields.plan_ids")} help={t("admin.sales.help.plan_ids")} error={errorText(errors, "plan_ids")} wide>
          <div role="group" aria-label={t("admin.sales.fields.plan_ids")} className="flex flex-wrap gap-2">
            {plans.map((plan) => {
              const on = planIds.includes(plan.id);
              return (
                <button
                  key={plan.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPlanIds(on ? planIds.filter((item) => item !== plan.id) : [...planIds, plan.id])}
                  className={cn(
                    "flex min-h-10 items-center rounded-[12px] border px-3 py-1.5 text-[13.5px] font-bold transition-[background-color,border-color,color] duration-150",
                    on ? "border-brand bg-tint text-brand-text" : "border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink",
                    !plan.active && !on && "opacity-60",
                  )}
                >
                  {plan.name}
                </button>
              );
            })}
          </div>
        </Labeled>
        <Labeled id={`${id}-active`} label={t("admin.sales.fields.active")}>
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
