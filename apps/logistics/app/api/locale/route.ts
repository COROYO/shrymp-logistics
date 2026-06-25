import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "@/i18n/locale";

/**
 * Persist the user's chosen UI locale in a cookie. Called by the LocaleSwitcher
 * client component. Cookie is HTTP-only:false so a future client-side switch
 * could read it; not security-sensitive.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { locale?: string } | null;
  if (!body || !isLocale(body.locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }
  const c = await cookies();
  c.set(LOCALE_COOKIE, body.locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    httpOnly: false,
  });
  return NextResponse.json({ ok: true });
}
