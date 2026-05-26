import { NextResponse } from "next/server";
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
 * Set this URL as **App URL** AND as the only entry in **Allowed redirection
 * URLs** in the Shopify Partner Dashboard for the Custom Distribution App.
 *
 * Shopify hits this endpoint (NOT the merchant directly through our UI) with
 *   ?code=…&shop=…&hmac=…&host=…&timestamp=…
 * after the merchant has clicked the install link Shopify itself generated.
 *
 * We verify HMAC against the App's Client Secret, exchange the code for an
 * offline access token, persist it. No session/login here — the caller is
 * Shopify, not a browser-user.
 */
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
  const shop = params.get("shop") ?? "";
  const code = params.get("code");
  const hmac = params.get("hmac");

  if (!isValidShopDomain(shop)) {
    return plain(
      `invalid_callback_params: shop="${shop}" ist nicht *.myshopify.com`,
      400,
    );
  }
  if (!code) return plain("invalid_callback_params: code fehlt", 400);
  if (!hmac) return plain("invalid_callback_params: hmac fehlt", 400);

  // Optional Allowlist: only accept installs for the configured shop, so
  // some random other shopify shop can't push a token into our Firestore.
  const allowedShop = process.env.SHOPIFY_SHOP_DOMAIN?.trim();
  if (allowedShop && shop.toLowerCase() !== allowedShop.toLowerCase()) {
    return plain(
      `shop_not_allowed: SHOPIFY_SHOP_DOMAIN=${allowedShop}, callback for ${shop}`,
      403,
    );
  }

  const { apiSecret } = getAppCreds();
  if (!verifyInstallHmac(params, apiSecret)) {
    log.warn("shopify_callback_hmac_failed", { shop });
    return plain(
      "invalid_hmac: SHOPIFY_API_SECRET stimmt nicht mit dem Client Secret der App überein.",
      401,
    );
  }

  let tokenResult;
  try {
    tokenResult = await exchangeCodeForToken(shop, code);
  } catch (e) {
    throw new Error(
      `token_exchange_failed (Shopify hat den code nicht akzeptiert — abgelaufen, schon eingelöst, oder API_KEY/SECRET passen nicht): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  try {
    await persistToken(shop, tokenResult.accessToken, tokenResult.scope);
  } catch (e) {
    throw new Error(
      `token_persist_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  log.info("shopify_install_complete", {
    shop,
    scope: tokenResult.scope,
  });
  return NextResponse.redirect(
    new URL("/admin/settings?installed=1", url.origin),
  );
}

function plain(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
