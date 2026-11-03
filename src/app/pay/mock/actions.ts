"use server";

import { getGateway, mockPay } from "@/server/billing/gateway";
import { siteOrigin } from "@/server/origin";

/**
 * The test bank's two buttons: the address of our return page with the gateway's usual words. The page
 * then leaves for it with a full load, as it would from a real bank (a router redirect would keep this
 * address in the bar).
 */
export async function mockBankAnswer(authority: string, back: string, paid: boolean): Promise<string | null> {
  if (!getGateway().isMock) return null;
  // Only our own return page: never a redirect anywhere else.
  let target: URL;
  try {
    target = new URL(back);
  } catch {
    return null;
  }
  if (target.origin !== (await siteOrigin()) || target.pathname !== "/pay/return") return null;
  if (paid) mockPay(authority);
  target.searchParams.set("Authority", authority);
  target.searchParams.set("Status", paid ? "OK" : "NOK");
  return target.toString();
}
