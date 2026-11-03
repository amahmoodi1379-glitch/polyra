import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { returnFromGateway } from "@/server/billing/orders";

/**
 * Where the gateway sends the learner back (PRD §12.4 steps 3–5). The gateway's own words in the address
 * (`Status`, `Authority`) are not trusted: the order is verified with the gateway, by its id and owner.
 * Then «اشتراک من» says what happened.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const orderId = Number(url.searchParams.get("order"));
  const user = await getCurrentUser();
  const back = (path: string) => NextResponse.redirect(new URL(path, url.origin), 303);
  if (!user) return back(`/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  if (!Number.isInteger(orderId)) return back("/");
  const result = await returnFromGateway(user.id, orderId);
  if (result.kind === "unknown") return back("/");
  return back(`/learn/${result.order.language}/subscription?order=${result.order.id}`);
}

export const dynamic = "force-dynamic";
