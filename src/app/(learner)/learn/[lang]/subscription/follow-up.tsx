"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { followUpPayment } from "@/app/(learner)/billing-actions";
import { t } from "@/i18n";
import type { FollowUp } from "@/server/billing/orders";

/** «پیگیری پرداخت» (PRD §12.4 step 7): asks the gateway again and says the answer in plain Persian. */
export function FollowUpButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [answer, setAnswer] = useState<FollowUp | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="follow-up">
      <button
        type="button"
        className="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await followUpPayment(orderId);
            setAnswer(result);
            if (result === "paid") router.refresh();
          })
        }
      >
        {t("learn.subscription.followUp")}
      </button>
      {answer ? (
        <p role="status" data-follow-up={answer}>
          {t(`learn.subscription.followUpAnswer.${answer}`)}
        </p>
      ) : null}
    </div>
  );
}
