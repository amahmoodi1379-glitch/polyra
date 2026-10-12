import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/server/auth/path-header";

/**
 * Staging gate. While SITE_PASSWORD is set, every page asks for a password first (browser login box,
 * any user name). This keeps the test version private: with the test SMS provider the login page
 * shows the code, so without a gate anyone could sign in with any phone number.
 *
 * Every request that passes also carries the page that was asked for: a layout runs before its page,
 * so without it the admin layout could only send a signed-out visitor back to /admin.
 */
export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return pass(request);

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (sameText(given, password)) return pass(request);
  }
  return new NextResponse("Polyra test version: password needed.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="polyra", charset="UTF-8"' },
  });
}

function pass(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

/** Compares in time that does not depend on where the texts differ. */
function sameText(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = {
  // The host's health check must pass without a password.
  matcher: ["/((?!api/health).*)"],
};
