"use client";

import { useState, useTransition } from "react";
import { deleteMyAccount, type DeleteReply } from "@/app/(learner)/account-actions";
import { t } from "@/i18n";

/** The two presses that delete the account: «حذف حساب», then «بله، برای همیشه حذف کن». */
export function DeleteAccount({ subscriptionNote }: { subscriptionNote: string | null }) {
  const [sure, setSure] = useState(false);
  const [reply, setReply] = useState<DeleteReply | null>(null);
  const [pending, start] = useTransition();
  const error = reply ? (reply.reason === "teacher" ? t("learn.account.delete.teacher") : t("errors.withCode", { code: reply.code ?? "" })) : null;

  if (!sure) {
    return (
      <button type="button" className="secondary danger" data-delete-account onClick={() => setSure(true)}>
        {t("learn.account.delete.button")}
      </button>
    );
  }
  return (
    <div className="confirm" role="alert">
      <span>{t("learn.account.delete.sure")}</span>
      {subscriptionNote ? <b>{subscriptionNote}</b> : null}
      {error ? <span className="form-error">{error}</span> : null}
      <div className="row">
        <button
          type="button"
          className="secondary danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              // A successful delete leaves for the login page; only a refusal comes back.
              setReply(await deleteMyAccount());
            })
          }
        >
          {pending ? t("common.loading") : t("learn.account.delete.yes")}
        </button>
        <button type="button" className="ghost" disabled={pending} onClick={() => setSure(false)}>
          {t("learn.account.delete.no")}
        </button>
      </div>
    </div>
  );
}
