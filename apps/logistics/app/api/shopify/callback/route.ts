import { NextResponse } from "next/server";
import {
  getAppCreds,
  isValidShopDomain,
  persistToken,
  verifyInstallHmac,
} from "@/server/shopify/auth";
import { exchangeCodeForExpiringToken } from "@/server/shopify/token";
import {
  OAUTH_STATE_TTL_MS,
  signOAuthState,
  verifyOAuthState,
} from "@/server/shopify/oauth-state";
import { getSessionUser } from "@/lib/auth/session";
import {
  linkUserToShop,
  assertShopLinkable,
  loadPendingShopDomain,
  ShopLinkError,
} from "@/lib/auth/merchant";
import { SHOP_COOKIE } from "@/lib/auth/tenant";
import { normalizeShopId } from "@/server/tenant/id";
import { REQUIRED_OAUTH_SCOPE_STRING } from "@/server/shopify/scopes";
import { log } from "@/lib/logger";

/** Reject install/callback requests with a stale timestamp (replay defense). */
function isFreshTimestamp(params: URLSearchParams): boolean {
  const raw = params.get("timestamp");
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(Date.now() - ts * 1000) < 5 * 60 * 1000;
}

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
 *         persist it in Firestore, link the shop to the merchant account,
 *         and forward to /admin/settings.
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
    return plain("callback_error", 500);
  }
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const params = url.searchParams;
  const shop = (params.get("shop") ?? "").trim();
  const code = params.get("code");
  const hmac = params.get("hmac");
  const stateParam = params.get("state");

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
    return plain("invalid_request", 401);
  }
  if (!isFreshTimestamp(params)) {
    log.warn("shopify_callback_stale_timestamp", { shop, hasCode: !!code });
    return plain("invalid_request", 401);
  }

  // ----- Case (A): initial install hit — no code yet, kick off OAuth ------
  if (!code) {
    const redirectUri = `${url.origin}/api/shopify/callback`;
    const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
    authorize.searchParams.set("client_id", apiKey);
    authorize.searchParams.set("scope", REQUIRED_OAUTH_SCOPE_STRING);
    authorize.searchParams.set("redirect_uri", redirectUri);

    const sessionUser = await getSessionUser();
    if (sessionUser?.role === "ADMIN") {
      const state = signOAuthState(
        {
          uid: sessionUser.uid,
          shop,
          exp: Date.now() + OAUTH_STATE_TTL_MS,
        },
        apiSecret,
      );
      authorize.searchParams.set("state", state);
    } else {
      authorize.searchParams.set("state", "install");
    }

    log.info("shopify_install_redirect_to_authorize", { shop, redirectUri });
    return NextResponse.redirect(authorize.toString());
  }

  // ----- Case (B): OAuth callback with code — exchange + persist ---------
  let tokenResult;
  try {
    tokenResult = await exchangeCodeForExpiringToken(shop, code);
  } catch (e) {
    throw new Error(
      `token_exchange_failed (code abgelaufen / schon eingelöst / API_KEY+SECRET passen nicht): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const shopId = await persistToken(shop, tokenResult);

  let linkUid: string | undefined;
  if (stateParam && stateParam !== "install") {
    const payload = verifyOAuthState(stateParam, apiSecret);
    if (payload?.shop === shop) linkUid = payload.uid;
  }
  // Fallback for Shopify-initiated installs (state="install"): only link the
  // logged-in ADMIN when their registration intent (pending_shop_domain)
  // matches this shop. This binds the link to a deliberate signup and prevents
  // a CSRF'd OAuth flow from attaching an arbitrary shop to a victim session.
  if (!linkUid) {
    const sessionUser = await getSessionUser();
    if (sessionUser?.role === "ADMIN") {
      const pending = await loadPendingShopDomain(sessionUser.uid);
      if (pending && normalizeShopId(pending) === shopId) {
        linkUid = sessionUser.uid;
      }
    }
  }
  if (linkUid) {
    try {
      await assertShopLinkable(linkUid, shopId);
      await linkUserToShop(linkUid, shopId);
    } catch (e) {
      if (e instanceof ShopLinkError) {
        log.warn("shopify_link_rejected", { shopId, uid: linkUid, code: e.code });
        return NextResponse.redirect(
          new URL(
            `/onboarding?error=${encodeURIComponent(e.message)}`,
            url.origin,
          ),
        );
      }
      throw e;
    }
  }

  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (appBaseUrl) {
    try {
      const { registerAllWebhooks } = await import(
        "@/server/shopify/register-webhooks"
      );
      await registerAllWebhooks(
        shopId,
        `${appBaseUrl}/api/webhooks/shopify`,
      );
    } catch (e) {
      log.error("shopify_install_webhooks_failed", {
        shopId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    log.warn("shopify_install_webhooks_skipped", {
      shopId,
      reason: "missing APP_BASE_URL",
    });
  }

  log.info("shopify_install_complete", {
    shop,
    shopId,
    scope: tokenResult.scope,
    linkedUid: linkUid ?? null,
  });

  const res = NextResponse.redirect(
    new URL("/onboarding/setup?installed=1", url.origin),
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
