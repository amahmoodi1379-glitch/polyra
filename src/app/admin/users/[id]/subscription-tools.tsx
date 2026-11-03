"use client";

import { useId, useState, useTransition } from "react";
import { CalendarMinus, CalendarPlus, LoaderCircle } from "lucide-react";
import { Segmented } from "@/app/admin/content/[type]/[id]/form-kit";
import { grantAction, shortenAction, type FormReply } from "@/app/admin/sales/actions";
import { errorText, inputClass, Labeled, NumberInput, ReplyLine, replyErrors } from "@/app/admin/sales/kit";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";

type Plan = { id: number; language: string; name: string; days: number; active: boolean };
const languageName = (language: string) => (language === "fr" || language === "de" ? t(`common.languages.${language}`) : language);

/** «اعطای دستی» and «کم کردن یا لغو» on an account (PRD §12.3), each with a required note. */
export function SubscriptionTools({ userId, languages, plans, active }: { userId: number; languages: string[]; plans: Plan[]; active: string[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <GrantForm userId={userId} languages={languages} plans={plans} />
      <ShortenForm userId={userId} languages={languages} active={active} />
    </div>
  );
}

function Card({ icon, title, lead, children }: { icon: React.ReactNode; title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface flex flex-col gap-4 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)] sm:px-6">
      <div className="flex items-start gap-3.5">
        <span className="bg-tint text-brand-text grid size-10 shrink-0 place-items-center rounded-[13px]">{icon}</span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-ink text-[16px] font-extrabold">{title}</h3>
          <p className="text-ink-3 text-[13px] leading-6">{lead}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function LanguagePick({ languages, value, onChange }: { languages: string[]; value: string; onChange: (value: string) => void }) {
  if (languages.length < 2) return null;
  return <Segmented value={value} onChange={onChange} label={t("admin.sales.fields.language")} options={languages.map((code) => ({ value: code, label: languageName(code) }))} />;
}

function GrantForm({ userId, languages, plans }: { userId: number; languages: string[]; plans: Plan[] }) {
  const id = useId();
  const [language, setLanguage] = useState(languages[0]);
  const ofLanguage = plans.filter((plan) => plan.language === language);
  const [by, setBy] = useState<"plan" | "days">(ofLanguage.length > 0 ? "plan" : "days");
  const [planId, setPlanId] = useState<number | null>(ofLanguage.find((plan) => plan.active)?.id ?? ofLanguage[0]?.id ?? null);
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState<FormReply | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = replyErrors(reply);

  const pickLanguage = (next: string) => {
    setLanguage(next);
    const list = plans.filter((plan) => plan.language === next);
    setPlanId(list.find((plan) => plan.active)?.id ?? list[0]?.id ?? null);
    if (list.length === 0) setBy("days");
  };

  const submit = () =>
    startTransition(async () => {
      const result = await grantAction(userId, { language, note, ...(by === "plan" ? { planId: planId ?? "" } : { days }) });
      setReply(result);
      setDone(result.ok ? t("admin.sales.saved") : null);
      if (result.ok) {
        setNote("");
        setDays("");
      }
    });

  return (
    <Card icon={<CalendarPlus className="size-5" strokeWidth={1.75} aria-hidden />} title={t("admin.users.sales.grant.title")} lead={t("admin.users.sales.grant.lead")}>
      <form
        data-grant-form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <LanguagePick languages={languages} value={language} onChange={pickLanguage} />
        {ofLanguage.length > 0 ? (
          <Segmented
            value={by}
            onChange={(next) => setBy(next as "plan" | "days")}
            label={t("admin.users.sales.grant.title")}
            options={[
              { value: "plan", label: t("admin.users.sales.grant.byPlan") },
              { value: "days", label: t("admin.users.sales.grant.byDays") },
            ]}
          />
        ) : null}
        {by === "plan" && ofLanguage.length > 0 ? (
          <div role="radiogroup" aria-label={t("admin.users.sales.grant.plan")} className="flex flex-wrap gap-2">
            {ofLanguage.map((plan) => (
              <button
                key={plan.id}
                type="button"
                role="radio"
                aria-checked={planId === plan.id}
                onClick={() => setPlanId(plan.id)}
                className={cn(
                  "flex min-h-10 items-baseline gap-2 rounded-[12px] border px-3 py-1.5 text-[13.5px] font-bold transition-[background-color,border-color,color] duration-150",
                  planId === plan.id ? "border-brand bg-tint text-brand-text" : "border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink",
                  !plan.active && planId !== plan.id && "opacity-60",
                )}
              >
                {plan.name}
                <span className="text-ink-3 text-[12.5px] font-medium">{t("admin.sales.days", { n: formatNumber(plan.days) })}</span>
              </button>
            ))}
            {errorText(errors, "planId") ? (
              <p role="alert" className="text-bad w-full text-[13px] font-bold">
                {errorText(errors, "planId")}
              </p>
            ) : null}
          </div>
        ) : (
          <Labeled id={`${id}-days`} label={t("admin.users.sales.grant.days")} error={errorText(errors, "days")}>
            <NumberInput id={`${id}-days`} value={days} onChange={setDays} invalid={!!errors.days} />
          </Labeled>
        )}
        <Labeled id={`${id}-note`} label={t("admin.users.sales.grant.note")} help={t("admin.users.sales.grant.noteHelp")} error={errorText(errors, "note")}>
          <input id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={!!errors.note || undefined} className={inputClass} />
        </Labeled>
        <ReplyLine reply={reply} done={done ?? undefined} />
        <Button type="submit" className="w-fit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
          {t("admin.users.sales.grant.submit")}
        </Button>
      </form>
    </Card>
  );
}

function ShortenForm({ userId, languages, active }: { userId: number; languages: string[]; active: string[] }) {
  const id = useId();
  const [language, setLanguage] = useState(active[0] ?? languages[0]);
  const [mode, setMode] = useState<"some" | "all">("some");
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [reply, setReply] = useState<FormReply | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = replyErrors(reply);

  const submit = () =>
    startTransition(async () => {
      const result = await shortenAction(userId, { language, note, ...(mode === "all" ? { cancel: true } : { days }) });
      setReply(result);
      setConfirming(false);
      if (result.ok) {
        setNote("");
        setDays("");
      }
    });

  return (
    <Card icon={<CalendarMinus className="size-5" strokeWidth={1.75} aria-hidden />} title={t("admin.users.sales.shorten.title")} lead={t("admin.users.sales.shorten.lead")}>
      <form
        data-shorten-form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "all" && !confirming) setConfirming(true);
          else submit();
        }}
      >
        <LanguagePick
          languages={languages}
          value={language}
          onChange={(next) => {
            setLanguage(next);
            setConfirming(false);
          }}
        />
        <Segmented
          value={mode}
          onChange={(next) => {
            setMode(next as "some" | "all");
            setConfirming(false);
          }}
          label={t("admin.users.sales.shorten.title")}
          options={[
            { value: "some", label: t("admin.users.sales.shorten.some") },
            { value: "all", label: t("admin.users.sales.shorten.all") },
          ]}
        />
        {mode === "some" ? (
          <Labeled id={`${id}-days`} label={t("admin.users.sales.shorten.days")} error={errorText(errors, "days")}>
            <NumberInput id={`${id}-days`} value={days} onChange={setDays} invalid={!!errors.days} />
          </Labeled>
        ) : null}
        <Labeled id={`${id}-note`} label={t("admin.users.sales.grant.note")} help={t("admin.users.sales.grant.noteHelp")} error={errorText(errors, "note")}>
          <input id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={!!errors.note || undefined} className={inputClass} />
        </Labeled>
        {confirming ? (
          <p role="alert" className="bg-bad-soft text-bad rounded-[14px] px-4 py-3 text-[13.5px] leading-6 font-bold">
            {t("admin.users.sales.shorten.confirm", { language: languageName(language) })}
          </p>
        ) : null}
        <ReplyLine reply={reply} done={t("admin.users.sales.shorten.done")} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="destructive" className="w-fit" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
            {mode === "some" ? t("admin.users.sales.shorten.submit") : confirming ? t("admin.users.sales.shorten.yes") : t("admin.users.sales.shorten.submitCancel")}
          </Button>
          {confirming ? (
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
