"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { payForPlan, priceWithCode, type PriceAnswer } from "@/app/(learner)/billing-actions";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import { formatNumber, t } from "@/i18n";
import type { CodeRefusal } from "@/server/billing/discounts";
import type { PlanCard } from "@/server/billing/learner";

const toman = (n: number) => t("learn.plans.toman", { n: formatNumber(n) });

/**
 * The plans of a language (PRD §12.4 step 1): pick one, type a code if there is one and see the price
 * at once, then «پرداخت» to the gateway. The server prices the order again; this is only what it shows.
 */
export function PlanPicker({ plans }: { plans: PlanCard[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<number>(plans[0].id);
  const [code, setCode] = useState("");
  const [priced, setPriced] = useState<{ planId: number; code: string; answer: PriceAnswer } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const plan = plans.find((item) => item.id === chosen) ?? plans[0];
  const current = priced && priced.planId === plan.id && priced.code === code.trim() ? priced.answer : null;
  const refusal = (reason: "gone" | CodeRefusal) => t(`learn.plans.code.${reason}`);

  const apply = () =>
    start(async () => {
      setProblem(null);
      const answer = await priceWithCode(plan.id, code);
      setPriced({ planId: plan.id, code: code.trim(), answer });
    });

  const pay = () =>
    start(async () => {
      setProblem(null);
      sfx("release", 0.45);
      const answer = await payForPlan(plan.id, code);
      if (answer.kind === "go") window.location.assign(answer.url);
      else if (answer.kind === "free") router.push(`/learn/${answer.language}/subscription?order=${answer.orderId}`);
      else if (answer.kind === "refused") setProblem(refusal(answer.reason));
      else setProblem(t("learn.plans.gateway"));
    });

  return (
    <>
      <div className="plans" role="radiogroup" aria-label={t("learn.plans.title")}>
        {plans.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={item.id === plan.id}
            className="plan-card"
            data-plan={item.id}
            onClick={() => {
              sfx("press", 0.35);
              setChosen(item.id);
            }}
          >
            <span className="plan-name">
              {item.name}
              {item.badge ? <span className="plan-badge">{item.badge}</span> : null}
            </span>
            <span className="plan-days num">{t("learn.plans.days", { n: formatNumber(item.days) })}</span>
            <span className="plan-price num">{toman(item.price)}</span>
          </button>
        ))}
      </div>

      <div className="plan-code">
        <label className="field">
          <span>{t("learn.plans.codeLabel")}</span>
          <input
            className="code-field"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.trim()) {
                event.preventDefault();
                apply();
              }
            }}
          />
        </label>
        <button type="button" className="secondary" disabled={pending || !code.trim()} onClick={apply}>
          {t("learn.plans.apply")}
        </button>
      </div>

      <div className="plan-total num" role="status" data-total>
        {current?.ok ? (
          <>
            <span className="was">{toman(current.price)}</span>
            <b>{current.final === 0 ? t("learn.plans.free") : toman(current.final)}</b>
            <span className="off">{t("learn.plans.off", { n: toman(current.off) })}</span>
          </>
        ) : (
          <b>{toman(plan.price)}</b>
        )}
        {current && !current.ok ? <span className="bad">{refusal(current.reason)}</span> : null}
      </div>
      {problem ? (
        <p className="plan-problem" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="cta">
        <button type="button" className="primary jelly-press" disabled={pending} onPointerDown={(event) => squish(event.currentTarget)} onClick={pay}>
          {current?.ok && current.final === 0 ? t("learn.plans.activate") : t("learn.plans.pay")}
        </button>
      </div>
    </>
  );
}
