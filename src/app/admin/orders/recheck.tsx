"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { recheckOrder } from "@/app/admin/sales/actions";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/** «استعلام دوباره»: asks the gateway about one order now and says what it answered. */
export function RecheckButton({ orderId }: { orderId: number }) {
  const [answer, setAnswer] = useState<Awaited<ReturnType<typeof recheckOrder>> | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        data-recheck={orderId}
        onClick={() =>
          startTransition(async () => {
            setAnswer(await recheckOrder(orderId));
          })
        }
      >
        {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : <RefreshCw strokeWidth={1.75} aria-hidden />}
        {t("admin.orders.recheck")}
      </Button>
      {answer ? (
        <span role="status" className={cn("text-[13px] font-bold", answer === "paid" ? "text-ok" : "text-ink-2")}>
          {t(`admin.orders.answer.${answer}`)}
        </span>
      ) : null}
    </span>
  );
}
