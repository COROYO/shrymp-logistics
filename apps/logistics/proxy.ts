import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Next.js 16 proxy (formerly middleware).
 *
 * Lightweight gatekeeper: blocks unauthenticated requests to (admin) and (lager)
 * route groups by checking only the presence of the session cookie. Actual
 * verification + role enforcement happens server-side in the route layouts via
 * `getSessionUser()` / `requireRole()`.
 *
 * Webhook routes (`/api/webhooks/*`) must never be gated here — they
 * authenticate via Shopify HMAC, not cookies.
 */

const PROTECTED_PREFIXES = ["/admin", "/lager", "/onboarding", "/select-shop"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.get(SESSION_COOKIE)?.value;
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/lager/:path*", "/onboarding/:path*", "/select-shop"],
};
