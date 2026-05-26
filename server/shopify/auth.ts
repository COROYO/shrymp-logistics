import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { adminDb } from "@/server/firestore/admin";
import { Collections, ConfigDocs, type ShopifyToken } from "@/server/firestore/schema";
import { FieldValue } from "firebase-admin/firestore";
import { log } from "@/lib/logger";

/**
 * Shopify App OAuth credentials, sourced from env.
 *
 * The client secret is used for:
 *   - Verifying webhook HMAC signatures (X-Shopify-Hmac-Sha256)
 *   - Verifying OAuth install-redirect HMAC
 *   - Exchanging the OAuth code for an offline access token
 */
export type ShopifyAppCreds = {
  apiKey: string; // client ID
  apiSecret: string; // client secret
  scopes: string;
};

export function getAppCreds(): ShopifyAppCreds {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const scopes =
    process.env.SHOPIFY_SCOPES ??
    "read_products,read_orders,write_orders,read_inventory,write_inventory,read_fulfillments,write_fulfillments,read_locations";
  if (!apiKey || !apiSecret) {
    throw new Error("SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set");
  }
  return { apiKey, apiSecret, scopes };
}

/**
 * Shop-domain validator. Accepts only `*.myshopify.com` to avoid
 * arbitrary redirects.
 */
export function isValidShopDomain(shop: string | null | undefined): boolean {
  if (!shop) return false;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop.trim());
}

/**
 * Verify the HMAC parameter Shopify attaches to OAuth install / callback
 * redirects (different format from webhook HMAC: query-string based).
 */
export function verifyInstallHmac(
  params: URLSearchParams,
  apiSecret: string,
): boolean {
  const provided = params.get("hmac");
  if (!provided) return false;
  // Build the message: all params except `hmac`, sorted alphabetically, joined
  // as `key=value&key=value`.
  const entries: [string, string][] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hmac") continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");

  const expected = createHmac("sha256", apiSecret)
    .update(message, "utf8")
    .digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ----------------------- token persistence -----------------------

const tokenRef = () =>
  adminDb().collection(Collections.Config).doc(ConfigDocs.ShopifyToken);

const metaRef = () =>
  adminDb().collection(Collections.Config).doc(ConfigDocs.ShopifyMeta);

let cachedToken: { token: ShopifyToken; loadedAtMs: number } | null = null;
const TOKEN_CACHE_TTL_MS = 60_000;

export async function loadStoredToken(): Promise<ShopifyToken | null> {
  if (cachedToken && Date.now() - cachedToken.loadedAtMs < TOKEN_CACHE_TTL_MS) {
    return cachedToken.token;
  }
  const snap = await tokenRef().get();
  if (!snap.exists) {
    cachedToken = null;
    return null;
  }
  const token = snap.data() as ShopifyToken;
  cachedToken = { token, loadedAtMs: Date.now() };
  return token;
}

export function invalidateTokenCache() {
  cachedToken = null;
}

export async function persistToken(
  shopDomain: string,
  accessToken: string,
  scope: string,
  installedByUid: string | null,
): Promise<void> {
  await tokenRef().set(
    {
      shop_domain: shopDomain,
      access_token: accessToken,
      scope,
      installed_at: FieldValue.serverTimestamp(),
      installed_by_uid: installedByUid,
    },
    { merge: false },
  );
  await metaRef().set(
    {
      shop_domain: shopDomain,
      api_version: process.env.SHOPIFY_API_VERSION ?? "2026-04",
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  invalidateTokenCache();
  log.info("shopify_token_persisted", { shopDomain, scope });
}

// ----------------------- OAuth helpers -----------------------

/**
 * Build the Shopify OAuth install URL (= where the merchant gets sent to grant
 * scopes). After granting, Shopify redirects back to `redirectUri` with
 * `?code=...&shop=...&state=...&hmac=...&timestamp=...`.
 */
export function buildInstallUrl(
  shop: string,
  redirectUri: string,
  state: string,
): string {
  const { apiKey, scopes } = getAppCreds();
  const u = new URL(`https://${shop}/admin/oauth/authorize`);
  u.searchParams.set("client_id", apiKey);
  u.searchParams.set("scope", scopes);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  // grant_options[]=value would request online tokens; we want offline.
  return u.toString();
}

export function generateInstallState(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Exchange an OAuth `code` for an offline access token.
 */
export async function exchangeCodeForToken(
  shop: string,
  code: string,
): Promise<{ accessToken: string; scope: string }> {
  const { apiKey, apiSecret } = getAppCreds();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Shopify token exchange failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    scope?: string;
  };
  if (!data.access_token) {
    throw new Error("Shopify token exchange returned no access_token");
  }
  return { accessToken: data.access_token, scope: data.scope ?? "" };
}
