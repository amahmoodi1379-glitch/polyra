import { describe, expect, it } from "vitest";
import { zarinpalGateway } from "@/server/billing/gateway";
import { discountOff, normalizeCode } from "@/server/billing/discounts";

/** ZarinPal's REST API v4 as the app speaks it (PRD §12.4), with a fake network. */

function fakeFetch(answers: Record<string, unknown>, seen: { url: string; body: Record<string, unknown> }[]) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const key = String(url).split("/").pop()!.replace(".json", "");
    seen.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("ZarinPal", () => {
  it("request: rials, the return address and the mobile; StartPay with the authority", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const gateway = zarinpalGateway({ merchantId: "m-1", fetch: fakeFetch({ request: { data: { code: 100, authority: "A0001" }, errors: [] } }, seen) });
    const start = await gateway.request({ orderId: 7, amountToman: 200_000, callbackUrl: "https://polyra.ir/pay/return?order=7", description: "ماهانه", mobile: "+989121234567" });
    expect(start).toEqual({ ok: true, authority: "A0001", payUrl: "https://payment.zarinpal.com/pg/StartPay/A0001" });
    expect(seen[0].body).toMatchObject({ merchant_id: "m-1", amount: 2_000_000, callback_url: "https://polyra.ir/pay/return?order=7", metadata: { mobile: "09121234567", order_id: "7" } });
  });

  it("request refused or unreachable: no payment", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const refused = zarinpalGateway({ merchantId: "m", fetch: fakeFetch({ request: { data: [], errors: { code: -9, message: "bad" } } }, seen) });
    expect((await refused.request({ orderId: 1, amountToman: 1000, callbackUrl: "x", description: "d", mobile: null })).ok).toBe(false);
    const down = zarinpalGateway({ merchantId: "m", fetch: fakeFetch({ request: new Error("offline") }, seen) });
    expect((await down.request({ orderId: 1, amountToman: 1000, callbackUrl: "x", description: "d", mobile: null })).ok).toBe(false);
  });

  it("verify: 100 and 101 (verified before) are paid with the reference; anything else is not", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    for (const code of [100, 101]) {
      const gateway = zarinpalGateway({ merchantId: "m", sandbox: true, fetch: fakeFetch({ verify: { data: { code, ref_id: 98765 }, errors: [] } }, seen) });
      expect(await gateway.verify({ authority: "A1", amountToman: 150_000 })).toEqual({ status: "paid", ref: "98765" });
    }
    expect(seen[0].url).toContain("sandbox.zarinpal.com");
    expect(seen[0].body).toMatchObject({ amount: 1_500_000, authority: "A1" });
    const failed = zarinpalGateway({ merchantId: "m", fetch: fakeFetch({ verify: { data: [], errors: { code: -51 } } }, seen) });
    expect((await failed.verify({ authority: "A1", amountToman: 1 })).status).toBe("failed");
  });

  it("inquiry: paid or verified is paid; failed or reversed not; still at the bank or no answer is unknown", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const ask = (status: unknown) => zarinpalGateway({ merchantId: "m", fetch: fakeFetch({ inquiry: { data: { code: 100, status }, errors: [] } }, seen) }).inquire({ authority: "A", amountToman: 1 });
    expect(await ask("PAID")).toBe("paid");
    expect(await ask("VERIFIED")).toBe("paid");
    expect(await ask("FAILED")).toBe("unpaid");
    expect(await ask("REVERSED")).toBe("unpaid");
    expect(await ask("IN_BANK")).toBe("unknown");
    expect(await ask(undefined)).toBe("unknown");
  });
});

describe("discount codes (PRD §12.3)", () => {
  it("case, spaces and Persian digits do not matter", () => {
    expect(normalizeCode(" bahar ۱۴۰۵ ")).toBe("BAHAR1405");
  });
  it("a percent rounds down to a toman; a fixed amount never makes the price negative", () => {
    expect(discountOff({ type: "percent", value: 15 }, 199_999)).toBe(29_999);
    expect(discountOff({ type: "amount", value: 500_000 }, 200_000)).toBe(200_000);
    expect(discountOff({ type: "percent", value: 100 }, 200_000)).toBe(200_000);
  });
});
