"use client";

import { useTransition } from "react";
import { t } from "@/i18n";
import { mockBankAnswer } from "./actions";

export function MockBank({ authority, back }: { authority: string; back: string }) {
  const [pending, start] = useTransition();
  const answer = (paid: boolean) =>
    start(async () => {
      const next = await mockBankAnswer(authority, back, paid);
      if (next) window.location.assign(next);
    });
  return (
    <div className="flex flex-col gap-2.5 pt-2">
      <button type="button" className="bg-brand text-on-brand min-h-[52px] rounded-[16px] text-[16px] font-extrabold disabled:opacity-50" disabled={pending} onClick={() => answer(true)}>
        {t("pay.mock.pay")}
      </button>
      <button type="button" className="text-ink-2 hover:bg-tint min-h-[46px] rounded-[14px] text-[14.5px] font-bold disabled:opacity-50" disabled={pending} onClick={() => answer(false)}>
        {t("pay.mock.cancel")}
      </button>
    </div>
  );
}
