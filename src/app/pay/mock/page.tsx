import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatNumber, t } from "@/i18n";
import { getGateway } from "@/server/billing/gateway";
import { MockBank } from "./mock-bank";

export const metadata: Metadata = { title: t("pay.mock.title") };
export const dynamic = "force-dynamic";

/**
 * The test gateway's "bank page" (`PAYMENT_GATEWAY=mock`): «پرداخت موفق» or «انصراف», then back to our
 * return address the way a real gateway sends people back. Nothing is charged. Gone with a real gateway.
 */
export default async function MockBankPage({ searchParams }: PageProps<"/pay/mock">) {
  if (!getGateway().isMock) notFound();
  const query = await searchParams;
  const authority = typeof query.authority === "string" ? query.authority : "";
  const back = typeof query.back === "string" ? query.back : "";
  const amount = Number(query.amount);
  if (!authority || !back) notFound();
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="bg-surface flex w-full max-w-[420px] flex-col gap-4 rounded-[24px] p-6 shadow-[var(--shadow-1)]">
        <p className="bg-tint text-ink-2 w-fit rounded-[10px] px-3 py-1 text-[12.5px] font-bold">{t("pay.mock.tag")}</p>
        <h1 className="text-ink text-[24px] font-extrabold">{t("pay.mock.heading")}</h1>
        <p className="text-ink text-[20px] font-extrabold tabular-nums" data-mock-amount>
          {t("pay.mock.amount", { n: formatNumber(Number.isFinite(amount) ? amount : 0) })}
        </p>
        <p className="text-ink-2 text-[14px] leading-7">{t("pay.mock.lead")}</p>
        <MockBank authority={authority} back={back} />
      </div>
    </main>
  );
}
