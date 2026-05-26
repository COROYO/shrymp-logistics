import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import {
  buildInstallUrl,
  generateInstallState,
  isValidShopDomain,
} from "@/server/shopify/auth";
import { log } from "@/lib/logger";

/**
 * GET /api/shopify/install?shop=<shop>.myshopify.com
 *
 * Starts the OAuth install flow. Generates a CSRF `state` token, stores it in
 * an httpOnly cookie, and 302-redirects to Shopify's authorize endpoint.
 *
 * Only ADMIN users may initiate install.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const shop = (
    url.searchParams.get("shop") ?? process.env.SHOPIFY_SHOP_DOMAIN ?? ""
  ).trim();
  if (!isValidShopDomain(shop)) {
    return new Response("invalid_shop", { status: 400 });
  }

  const base = process.env.APP_BASE_URL;
  if (!base) return new Response("APP_BASE_URL not set", { status: 500 });

  const redirectUri = `${normalizeBaseUrl(base)}/api/shopify/callback`;
  const state = generateInstallState();
  const target = buildInstallUrl(shop, redirectUri, state);

  const jar = await cookies();
  jar.set("shopify_install_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  jar.set("shopify_install_shop", shop, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  log.info("shopify_install_start", { shop, redirectUri });
  return NextResponse.redirect(target);
}

function normalizeBaseUrl(s: string): string {
  const trimmed = s.replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
