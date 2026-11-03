/**
 * The payment gateway behind one interface (PRD §12.4: `PaymentGateway`), so moving to another Iranian
 * gateway needs no rewrite. Amounts are tomans everywhere in the app; a gateway converts if it must.
 *
 * - `zarinpal`: ZarinPal's REST API v4 (request, StartPay, verify, inquiry), its sandbox with
 *   `ZARINPAL_SANDBOX=1`.
 * - `mock`: a test gateway for the staging server and the tests. Its "bank page" is our own
 *   `/pay/mock` page with «پرداخت موفق» and «انصراف»; nothing is charged.
 *
 * `PAYMENT_GATEWAY` picks one (default `mock`, like `SMS_PROVIDER`).
 */

export type PayRequest = { orderId: number; amountToman: number; callbackUrl: string; description: string; mobile: string | null };
export type PayStart = { ok: true; authority: string; payUrl: string } | { ok: false; reason: string };
/** After the learner comes back: paid (with the bank's reference), paid before (a repeat verify), or not paid. */
export type PayVerify = { status: "paid"; ref: string } | { status: "failed"; reason: string };
/** Asking the gateway about a payment the learner may not have come back from (PRD §12.4 step 6). */
export type PayInquiry = "paid" | "unpaid" | "unknown";

export interface PaymentGateway {
  readonly name: string;
  /** True for the test gateway: the plans page says nothing is charged. */
  readonly isMock: boolean;
  request(input: PayRequest): Promise<PayStart>;
  verify(input: { authority: string; amountToman: number }): Promise<PayVerify>;
  inquire(input: { authority: string; amountToman: number }): Promise<PayInquiry>;
}

// ───────────────────────────── mock ─────────────────────────────

type MockState = { amountToman: number; paid: boolean; ref: string | null };
const g = globalThis as unknown as { polyraMockPayments?: Map<string, MockState> };
const mockPayments = (g.polyraMockPayments ??= new Map<string, MockState>());

/** The test bank's answer: «پرداخت موفق» on `/pay/mock`, or a test that pays on the learner's behalf. */
export function mockPay(authority: string): boolean {
  const state = mockPayments.get(authority);
  if (!state) return false;
  state.paid = true;
  state.ref ??= `T${Date.now().toString().slice(-9)}`;
  return true;
}

export const mockGateway: PaymentGateway = {
  name: "mock",
  isMock: true,
  async request(input) {
    const authority = `MOCK${input.orderId}x${Math.random().toString(36).slice(2, 10)}`;
    mockPayments.set(authority, { amountToman: input.amountToman, paid: false, ref: null });
    const back = encodeURIComponent(input.callbackUrl);
    return { ok: true, authority, payUrl: `/pay/mock?authority=${authority}&amount=${input.amountToman}&back=${back}` };
  },
  async verify({ authority, amountToman }) {
    const state = mockPayments.get(authority);
    if (!state || !state.paid || !state.ref) return { status: "failed", reason: "not paid" };
    if (state.amountToman !== amountToman) return { status: "failed", reason: "amount" };
    return { status: "paid", ref: state.ref };
  },
  async inquire({ authority }) {
    const state = mockPayments.get(authority);
    if (!state) return "unknown";
    return state.paid ? "paid" : "unpaid";
  },
};

// ───────────────────────────── ZarinPal ─────────────────────────────

type ZarinpalOptions = { merchantId: string; sandbox?: boolean; fetch?: typeof fetch; timeoutMs?: number };
type ZarinpalAnswer = { data?: { code?: number; authority?: string; ref_id?: number | string; status?: string; message?: string } | unknown[]; errors?: { code?: number; message?: string } | unknown[] };

/** Toman to rial: ZarinPal's default currency is the rial. */
const RIAL_PER_TOMAN = 10;
/** ZarinPal's codes: 100 done, 101 verified before (the same payment, a refresh of the return page). */
const ZP_OK = 100;
const ZP_VERIFIED_BEFORE = 101;

export function zarinpalGateway({ merchantId, sandbox = false, fetch: send = fetch, timeoutMs = 15_000 }: ZarinpalOptions): PaymentGateway {
  const api = sandbox ? "https://sandbox.zarinpal.com/pg/v4/payment" : "https://payment.zarinpal.com/pg/v4/payment";
  const start = sandbox ? "https://sandbox.zarinpal.com/pg/StartPay" : "https://payment.zarinpal.com/pg/StartPay";
  async function call(path: string, body: Record<string, unknown>): Promise<ZarinpalAnswer | null> {
    try {
      const response = await send(`${api}/${path}.json`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ merchant_id: merchantId, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return (await response.json().catch(() => null)) as ZarinpalAnswer | null;
    } catch {
      return null;
    }
  }
  const dataOf = (answer: ZarinpalAnswer | null) => (answer && answer.data && !Array.isArray(answer.data) ? answer.data : null);
  const errorOf = (answer: ZarinpalAnswer | null) => (answer && answer.errors && !Array.isArray(answer.errors) ? answer.errors : null);
  return {
    name: "zarinpal",
    isMock: false,
    async request(input) {
      const answer = await call("request", {
        amount: input.amountToman * RIAL_PER_TOMAN,
        callback_url: input.callbackUrl,
        description: input.description,
        metadata: { order_id: String(input.orderId), ...(input.mobile ? { mobile: input.mobile.replace(/^\+98/, "0") } : {}) },
      });
      const data = dataOf(answer);
      if (data?.code === ZP_OK && data.authority) return { ok: true, authority: data.authority, payUrl: `${start}/${data.authority}` };
      return { ok: false, reason: `ZarinPal request: ${errorOf(answer)?.code ?? "unreachable"} ${errorOf(answer)?.message ?? ""}`.trim() };
    },
    async verify({ authority, amountToman }) {
      const answer = await call("verify", { amount: amountToman * RIAL_PER_TOMAN, authority });
      const data = dataOf(answer);
      if ((data?.code === ZP_OK || data?.code === ZP_VERIFIED_BEFORE) && data.ref_id !== undefined) return { status: "paid", ref: String(data.ref_id) };
      return { status: "failed", reason: `ZarinPal verify: ${errorOf(answer)?.code ?? data?.code ?? "unreachable"}` };
    },
    async inquire({ authority }) {
      const answer = await call("inquiry", { authority });
      const status = dataOf(answer)?.status;
      if (status === "PAID" || status === "VERIFIED") return "paid";
      if (status === "FAILED" || status === "REVERSED" || status === "IN_BANK") return status === "IN_BANK" ? "unknown" : "unpaid";
      return "unknown";
    },
  };
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let override: PaymentGateway | null = null;
/** Tests put their own gateway in place (a ZarinPal answer that never comes, a payment that fails). */
export function useGateway(gateway: PaymentGateway | null) {
  override = gateway;
}

export function getGateway(): PaymentGateway {
  if (override) return override;
  const name = process.env.PAYMENT_GATEWAY ?? "mock";
  if (name === "mock") return mockGateway;
  if (name === "zarinpal") return zarinpalGateway({ merchantId: required("ZARINPAL_MERCHANT_ID"), sandbox: process.env.ZARINPAL_SANDBOX === "1" });
  throw new Error(`Unknown PAYMENT_GATEWAY: ${name}`);
}
