import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import {
  exchangeCodeForToken,
  getAppCreds,
  isValidShopDomain,
  persistToken,
  verifyInstallHmac,
} from "@/server/shopify/auth";
import { log } from "@/lib/logger";

/**
 * GET /api/shopify/callback
 *
 * OAuth callback. Verifies install HMAC + state, exchanges code for an
 * offline access token, persists it to Firestore.
 *
 * The user is expected to be logged in as ADMIN (the same session that
 * started the install).
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const params = url.searchParams;
  const shop = params.get("shop") ?? "";
  const code = params.get("code");
  const state = params.get("state");

  if (!isValidShopDomain(shop) || !code || !state) {
    return new Response("invalid_callback_params", { status: 400 });
  }

  const jar = await cookies();
  const cookieState = jar.get("shopify_install_state")?.value;
  const cookieShop = jar.get("shopify_install_shop")?.value;
  if (!cookieState || cookieState !== state || cookieShop !== shop) {
    log.warn("shopify_callback_state_mismatch", {
      shop,
      hasCookie: !!cookieState,
    });
    return new Response("state_mismatch", { status: 400 });
  }

  const creds = getAppCreds();
  if (!verifyInstallHmac(params, creds.apiSecret)) {
    log.warn("shopify_callback_hmac_failed", { shop });
    return new Response("invalid_hmac", { status: 401 });
  }

  try {
    const { accessToken, scope } = await exchangeCodeForToken(shop, code);
    await persistToken(shop, accessToken, scope, user.uid);
  } catch (e) {
    log.error("shopify_token_exchange_failed", {
      shop,
      error: String(e),
    });
    return new Response("token_exchange_failed", { status: 500 });
  }

  // Clear install cookies.
  jar.set("shopify_install_state", "", { path: "/", maxAge: 0 });
  jar.set("shopify_install_shop", "", { path: "/", maxAge: 0 });

  const success = new URL("/admin/settings", url.origin);
  success.searchParams.set("installed", "1");
  return NextResponse.redirect(success);
}
