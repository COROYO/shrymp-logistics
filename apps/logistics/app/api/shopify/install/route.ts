import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getAppCreds, isValidShopDomain } from "@/server/shopify/auth";
import {
  OAUTH_STATE_TTL_MS,
  signOAuthState,
} from "@/server/shopify/oauth-state";
import { normalizeShopDomainInput } from "@/server/tenant/id";
import { REQUIRED_OAUTH_SCOPE_STRING } from "@/server/shopify/scopes";
import { log } from "@/lib/logger";

/**
 * GET /api/shopify/install?shop=my-store.myshopify.com
 *
 * Authenticated one-click Shopify OAuth kickoff. Merchants never enter API keys.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", new URL(req.url).pathname + new URL(req.url).search);
    return NextResponse.redirect(url);
  }
  if (user.role !== "ADMIN") {
    return new Response("Nur Shop-Admins können Shopify verbinden.", {
      status: 403,
    });
  }

  const url = new URL(req.url);
  const rawShop = url.searchParams.get("shop") ?? "";
  const shop =
    normalizeShopDomainInput(rawShop) ??
    (isValidShopDomain(rawShop) ? rawShop.trim().toLowerCase() : null);

  if (!shop) {
    return new Response(
      "Ungültige Shop-Domain — bitte z. B. mein-shop oder mein-shop.myshopify.com angeben.",
      { status: 400 },
    );
  }

  const { apiKey, apiSecret } = getAppCreds();
  const state = signOAuthState(
    {
      uid: user.uid,
      shop,
      exp: Date.now() + OAUTH_STATE_TTL_MS,
    },
    apiSecret,
  );

  const redirectUri = `${url.origin}/api/shopify/callback`;
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", apiKey);
  authorize.searchParams.set("scope", REQUIRED_OAUTH_SCOPE_STRING);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);

  log.info("shopify_install_redirect", { shop, uid: user.uid });
  return NextResponse.redirect(authorize.toString());
}
