import { headers } from "next/headers";

/**
 * Our own address, for the gateway's return link (PRD §12.4): `SITE_URL` when the host sets it, else
 * what the request came to (the host's proxy says https in `x-forwarded-proto`).
 */
export async function siteOrigin(): Promise<string> {
  const fixed = process.env.SITE_URL?.replace(/\/+$/, "");
  if (fixed) return fixed;
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
