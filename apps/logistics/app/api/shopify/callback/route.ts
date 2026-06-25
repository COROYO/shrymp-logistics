import { NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  getAppCreds,
  isValidShopDomain,
  persistToken,
  verifyInstallHmac,
} from "@/server/shopify/auth";
import { SHOP_COOKIE } from "@/lib/auth/tenant";
import { log } from "@/lib/logger";

/**
 * GET /api/shopify/callback
 *
 * Single endpoint registered as BOTH the App URL and the only Allowed
 * Redirection URL in the Shopify Partner Dashboard. Handles two cases:
 *
 *   (A) Initial install hit: Shopify sends merchant here with
 *       ?hmac=…&host=…&shop=…&timestamp=…   (no `code`)
 *       → we verify HMAC and 302-redirect to the shop's OAuth Authorize URL.
 *
 *   (B) OAuth callback: after merchant approves, Shopify redirects back here
 *       with ?code=…&hmac=…&host=…&shop=…&state=…&timestamp=…
 *       → we verify HMAC, exchange `code` for an offline access token,
 *         persist it in Firestore, and forward to /admin/settings.
 *
 * No session/cookie required — Shopify is the caller in both cases, and the
 * HMAC (signed with our Client Secret) guarantees authenticity.
 */

const REQUIRED_SCOPES = [
  "read_products",
  "read_orders",
  "write_orders",
  "read_inventory",
  "write_inventory",
  "read_fulfillments",
  "write_fulfillments",
  "read_locations",
];

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("shopify_callback_500", {
      error: msg,
      stack: e instanceof Error ? e.stack : undefined,
    });
    return plain(`callback_error: ${msg}`, 500);
  }
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const params = url.searchParams;
  const shop = (params.get("shop") ?? "").trim();
  const code = params.get("code");
  const hmac = params.get("hmac");

  if (!isValidShopDomain(shop)) {
    return plain(
      `invalid_callback_params: shop="${shop}" ist nicht *.myshopify.com`,
      400,
    );
  }
  if (!hmac) return plain("invalid_callback_params: hmac fehlt", 400);

  const { apiKey, apiSecret } = getAppCreds();
  if (!verifyInstallHmac(params, apiSecret)) {
    log.warn("shopify_callback_hmac_failed", { shop, hasCode: !!code });
    return plain(
      "invalid_hmac: SHOPIFY_API_SECRET stimmt nicht mit dem Client Secret der App überein.",
      401,
    );
  }

  // ----- Case (A): initial install hit — no code yet, kick off OAuth ------
  if (!code) {
    const redirectUri = `${url.origin}/api/shopify/callback`;
    const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
    authorize.searchParams.set("client_id", apiKey);
    authorize.searchParams.set("scope", REQUIRED_SCOPES.join(","));
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", "install");
    log.info("shopify_install_redirect_to_authorize", { shop, redirectUri });
    return NextResponse.redirect(authorize.toString());
  }

  // ----- Case (B): OAuth callback with code — exchange + persist ---------
  let tokenResult;
  try {
    tokenResult = await exchangeCodeForToken(shop, code);
  } catch (e) {
    throw new Error(
      `token_exchange_failed (code abgelaufen / schon eingelöst / API_KEY+SECRET passen nicht): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const shopId = await persistToken(
    shop,
    tokenResult.accessToken,
    tokenResult.scope,
  );

  log.info("shopify_install_complete", {
    shop,
    shopId,
    scope: tokenResult.scope,
  });
  const res = NextResponse.redirect(
    new URL("/admin/settings?installed=1", url.origin),
  );
  res.cookies.set(SHOP_COOKIE, shopId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}

function plain(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
