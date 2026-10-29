import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { log } from "@/lib/logger";
import { loadAppCredsForTokenRefresh } from "./app-credentials";
import type { ShopifyAppCreds } from "./app-credentials";
import {
  getShop,
  saveShopOAuthTokens,
  type ShopCredentials,
  type ShopOAuthTokenBundle,
} from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";
import {
  REFRESH_BEFORE_EXPIRY_MS,
  isAccessTokenDueForRefresh,
  parseExpiringTokenResponse,
  readOAuthErrorCode,
  type ExpiringTokenResponse,
} from "./token-policy";

export class ShopifyOAuthError extends Error {
  readonly status: number;
  readonly oauthError?: string;

  constructor(status: number, body: string) {
    const oauthError = readOAuthErrorCode(body);
    super(
      `Shopify OAuth token request failed (${status}${
        oauthError ? ` ${oauthError}` : ""
      }): ${body.slice(0, 300)}`,
    );
    this.name = "ShopifyOAuthError";
    this.status = status;
    this.oauthError = oauthError;
  }
}

function isRejectedRefreshToken(err: unknown): boolean {
  return (
    err instanceof ShopifyOAuthError &&
    err.status === 401 &&
    err.oauthError === "invalid_request"
  );
}

const tokenLocks = new Map<string, Promise<ShopCredentials | null>>();
const credentialCache = new Map<
  string,
  { creds: ShopCredentials; validUntilMs: number }
>();

function cacheCredentials(shopId: string, creds: ShopCredentials): void {
  if (
    isAccessTokenDueForRefresh(
      creds.access_token_expires_at_ms,
      !!creds.refresh_token,
    )
  ) {
    return;
  }
  const expiresMs = creds.access_token_expires_at_ms;
  const validUntilMs = expiresMs
    ? Math.min(expiresMs - REFRESH_BEFORE_EXPIRY_MS, Date.now() + 60_000)
    : Date.now() + 60_000;
  if (validUntilMs > Date.now()) {
    credentialCache.set(shopId, { creds, validUntilMs });
  }
}

function readCachedCredentials(shopId: string): ShopCredentials | null {
  const cached = credentialCache.get(shopId);
  if (!cached) return null;
  if (cached.validUntilMs <= Date.now()) {
    credentialCache.delete(shopId);
    return null;
  }
  return cached.creds;
}

export function invalidateShopTokenCache(shopId?: string): void {
  // Locks stay. Dropping them mid-refresh lets a second caller rotate the
  // same refresh token before the first write lands.
  if (shopId) {
    credentialCache.delete(normalizeShopId(shopId));
  } else {
    credentialCache.clear();
  }
}

function trackTokenWork(
  shopId: string,
  work: Promise<ShopCredentials | null>,
): Promise<ShopCredentials | null> {
  const tracked = work.finally(() => {
    if (tokenLocks.get(shopId) === tracked) tokenLocks.delete(shopId);
  });
  tokenLocks.set(shopId, tracked);
  return tracked;
}

function timestampToMs(value: unknown): number | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (typeof value === "object" && value !== null) {
    if ("toMillis" in value && typeof value.toMillis === "function") {
      return value.toMillis();
    }
    if ("toDate" in value && typeof value.toDate === "function") {
      return value.toDate().getTime();
    }
    if ("seconds" in value && typeof value.seconds === "number") {
      return value.seconds * 1000;
    }
  }
  return undefined;
}

async function postOAuthToken(
  shopDomain: string,
  body: Record<string, string>,
): Promise<ShopOAuthTokenBundle> {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ShopifyOAuthError(res.status, text);
  }
  let json: ExpiringTokenResponse;
  try {
    json = JSON.parse(text) as ExpiringTokenResponse;
  } catch {
    throw new Error(
      `Shopify OAuth token response was not JSON: ${text.slice(0, 300)}`,
    );
  }
  return parseExpiringTokenResponse(json);
}

export async function exchangeCodeForExpiringToken(
  shop: string,
  code: string,
  creds: ShopifyAppCreds,
): Promise<ShopOAuthTokenBundle> {
  return postOAuthToken(shop, {
    client_id: creds.apiKey,
    client_secret: creds.apiSecret,
    code,
    expiring: "1",
  });
}

async function refreshExpiringToken(
  shopDomain: string,
  refreshToken: string,
): Promise<ShopOAuthTokenBundle> {
  const { apiKey, apiSecret } = await loadAppCredsForTokenRefresh(shopDomain);
  return postOAuthToken(shopDomain, {
    client_id: apiKey,
    client_secret: apiSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function migrateNonExpiringToken(
  shopDomain: string,
  accessToken: string,
): Promise<ShopOAuthTokenBundle> {
  const { apiKey, apiSecret } = await loadAppCredsForTokenRefresh(shopDomain);
  return postOAuthToken(shopDomain, {
    client_id: apiKey,
    client_secret: apiSecret,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: accessToken,
    subject_token_type:
      "urn:shopify:params:oauth:token-type:offline-access-token",
    requested_token_type:
      "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
}

function shopToCredentials(shop: {
  shop_domain: string;
  access_token?: string;
  scope?: string;
  refresh_token?: string;
  access_token_expires_at?: unknown;
}): ShopCredentials | null {
  if (!shop.access_token) return null;
  return {
    shop_domain: shop.shop_domain,
    access_token: shop.access_token,
    scope: shop.scope ?? "",
    refresh_token: shop.refresh_token,
    access_token_expires_at_ms: timestampToMs(shop.access_token_expires_at),
  };
}

function credentialsFromBundle(
  shopDomain: string,
  tokens: ShopOAuthTokenBundle,
): ShopCredentials | null {
  return shopToCredentials({
    shop_domain: shopDomain,
    access_token: tokens.accessToken,
    scope: tokens.scope,
    refresh_token: tokens.refreshToken,
    access_token_expires_at: tokens.accessTokenExpiresAtMs
      ? Timestamp.fromMillis(tokens.accessTokenExpiresAtMs)
      : undefined,
  });
}

async function persistResolvedTokens(
  shopId: string,
  shopDomain: string,
  tokens: ShopOAuthTokenBundle,
): Promise<ShopCredentials | null> {
  await saveShopOAuthTokens(shopId, tokens);
  invalidateShopTokenCache(shopId);
  const creds = credentialsFromBundle(shopDomain, tokens);
  if (creds) cacheCredentials(shopId, creds);
  return creds;
}

/**
 * Shopify keeps the presented refresh token valid until the replacement is
 * used. A 401 here usually means another instance already rotated it.
 * Re-read Firestore and continue with that pair instead of forcing reinstall.
 */
async function recoverRotatedRefresh(
  shopId: string,
  shopDomain: string,
  rejectedRefreshToken: string,
): Promise<ShopOAuthTokenBundle | null> {
  const latest = await getShop(shopId);
  if (
    !latest?.access_token ||
    !latest.refresh_token ||
    latest.refresh_token === rejectedRefreshToken
  ) {
    return null;
  }
  const latestExpiry = timestampToMs(latest.access_token_expires_at);
  if (!isAccessTokenDueForRefresh(latestExpiry, true)) {
    log.info("shopify_token_refresh_lost_race", { shopId });
    return {
      accessToken: latest.access_token,
      scope: latest.scope ?? "",
      refreshToken: latest.refresh_token,
      accessTokenExpiresAtMs: latestExpiry,
      refreshTokenExpiresAtMs: timestampToMs(latest.refresh_token_expires_at),
    };
  }
  try {
    log.info("shopify_token_refresh_lost_race", { shopId, retry: true });
    return await refreshExpiringToken(shopDomain, latest.refresh_token);
  } catch (e) {
    if (isRejectedRefreshToken(e)) return null;
    throw e;
  }
}

async function refreshOrReuse(
  shopId: string,
  shopDomain: string,
  refreshToken: string,
): Promise<ShopOAuthTokenBundle> {
  try {
    return await refreshExpiringToken(shopDomain, refreshToken);
  } catch (e) {
    if (!isRejectedRefreshToken(e)) throw e;
    const recovered = await recoverRotatedRefresh(
      shopId,
      shopDomain,
      refreshToken,
    );
    if (recovered) return recovered;
    throw new Error(
      "SHOPIFY_REAUTH_REQUIRED: Refresh token rejected — merchant must reinstall the app",
    );
  }
}

async function resolveShopCredentials(
  shopId: string,
  opts: { force?: boolean } = {},
): Promise<ShopCredentials | null> {
  const shop = await getShop(shopId);
  if (!shop?.access_token || shop.status !== "ACTIVE") return null;

  const accessExpiresMs = timestampToMs(shop.access_token_expires_at);
  const refreshExpiresMs = timestampToMs(shop.refresh_token_expires_at);

  if (!shop.refresh_token) {
    log.info("shopify_token_migrate_start", { shopId });
    const migrated = await migrateNonExpiringToken(
      shop.shop_domain,
      shop.access_token,
    );
    log.info("shopify_token_migrated", { shopId });
    return persistResolvedTokens(shopId, shop.shop_domain, migrated);
  }

  if (refreshExpiresMs !== undefined && refreshExpiresMs <= Date.now()) {
    throw new Error(
      "SHOPIFY_REAUTH_REQUIRED: Refresh token expired — merchant must reinstall the app",
    );
  }

  if (
    !opts.force &&
    !isAccessTokenDueForRefresh(accessExpiresMs, true)
  ) {
    const creds = shopToCredentials(shop);
    if (creds) cacheCredentials(shopId, creds);
    return creds;
  }

  log.info("shopify_token_refresh_start", { shopId, force: !!opts.force });
  const refreshed = await refreshOrReuse(
    shopId,
    shop.shop_domain,
    shop.refresh_token,
  );
  log.info("shopify_token_refreshed", { shopId });
  return persistResolvedTokens(shopId, shop.shop_domain, refreshed);
}

/** Load credentials, migrating legacy tokens and refreshing when needed. */
export async function ensureValidShopCredentials(
  shopId?: string,
): Promise<ShopCredentials | null> {
  const id = shopId ? normalizeShopId(shopId) : null;
  if (!id) return null;

  const cached = readCachedCredentials(id);
  if (cached) return cached;

  const pending = tokenLocks.get(id);
  if (pending) return pending;

  return trackTokenWork(id, resolveShopCredentials(id));
}

/**
 * Bypass the cache and rotate now. Used when the Admin API rejects the
 * access token (401, or 403 for a non-expiring offline token).
 */
export async function refreshShopCredentialsNow(
  shopId: string,
): Promise<ShopCredentials | null> {
  const id = normalizeShopId(shopId);
  credentialCache.delete(id);
  const pending = tokenLocks.get(id);
  if (pending) await pending.catch(() => null);
  credentialCache.delete(id);
  const again = tokenLocks.get(id);
  if (again) return again;
  return trackTokenWork(id, resolveShopCredentials(id, { force: true }));
}

/** Proactively migrate/refresh tokens for every active shop (cron). */
export async function ensureShopifyTokensForAllShops(): Promise<
  Array<{ shopId: string; ok: boolean; error?: string }>
> {
  const { listActiveShops } = await import("@/server/tenant/shop");
  const shops = await listActiveShops();
  const results: Array<{ shopId: string; ok: boolean; error?: string }> = [];
  for (const shop of shops) {
    try {
      await ensureValidShopCredentials(shop.id);
      results.push({ shopId: shop.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("shopify_token_ensure_failed", { shopId: shop.id, error: msg });
      results.push({ shopId: shop.id, ok: false, error: msg });
    }
  }
  return results;
}
