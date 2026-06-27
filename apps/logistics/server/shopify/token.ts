import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { log } from "@/lib/logger";
import { getAppCreds } from "./auth";
import {
  getShop,
  saveShopOAuthTokens,
  type ShopCredentials,
  type ShopOAuthTokenBundle,
} from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60_000;

type ShopifyTokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

const tokenLocks = new Map<string, Promise<ShopCredentials | null>>();
const credentialCache = new Map<
  string,
  { creds: ShopCredentials; validUntilMs: number }
>();

function cacheCredentials(shopId: string, creds: ShopCredentials): void {
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
  if (shopId) {
    const id = normalizeShopId(shopId);
    credentialCache.delete(id);
    tokenLocks.delete(id);
  } else {
    credentialCache.clear();
    tokenLocks.clear();
  }
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

function parseTokenResponse(data: ShopifyTokenResponse): ShopOAuthTokenBundle {
  if (!data.access_token) {
    throw new Error("Shopify token response missing access_token");
  }
  const now = Date.now();
  return {
    accessToken: data.access_token,
    scope: data.scope ?? "",
    refreshToken: data.refresh_token,
    accessTokenExpiresAtMs:
      typeof data.expires_in === "number"
        ? now + data.expires_in * 1000
        : undefined,
    refreshTokenExpiresAtMs:
      typeof data.refresh_token_expires_in === "number"
        ? now + data.refresh_token_expires_in * 1000
        : undefined,
  };
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
    throw new Error(
      `Shopify OAuth token request failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  let json: ShopifyTokenResponse;
  try {
    json = JSON.parse(text) as ShopifyTokenResponse;
  } catch {
    throw new Error(
      `Shopify OAuth token response was not JSON: ${text.slice(0, 300)}`,
    );
  }
  return parseTokenResponse(json);
}

export async function exchangeCodeForExpiringToken(
  shop: string,
  code: string,
): Promise<ShopOAuthTokenBundle> {
  const { apiKey, apiSecret } = getAppCreds();
  return postOAuthToken(shop, {
    client_id: apiKey,
    client_secret: apiSecret,
    code,
    expiring: "1",
  });
}

async function refreshExpiringToken(
  shopDomain: string,
  refreshToken: string,
): Promise<ShopOAuthTokenBundle> {
  const { apiKey, apiSecret } = getAppCreds();
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
  const { apiKey, apiSecret } = getAppCreds();
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

function isAccessTokenStale(expiresAtMs: number | undefined): boolean {
  if (!expiresAtMs) return false;
  return expiresAtMs - REFRESH_BEFORE_EXPIRY_MS <= Date.now();
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

async function resolveShopCredentials(
  shopId: string,
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
    await saveShopOAuthTokens(shopId, migrated);
    invalidateShopTokenCache(shopId);
    log.info("shopify_token_migrated", { shopId });
    const creds = shopToCredentials({
      shop_domain: shop.shop_domain,
      access_token: migrated.accessToken,
      scope: migrated.scope,
      refresh_token: migrated.refreshToken,
      access_token_expires_at: migrated.accessTokenExpiresAtMs
        ? Timestamp.fromMillis(migrated.accessTokenExpiresAtMs)
        : undefined,
    });
    if (creds) cacheCredentials(shopId, creds);
    return creds;
  }

  if (
    refreshExpiresMs !== undefined &&
    refreshExpiresMs <= Date.now()
  ) {
    throw new Error(
      "SHOPIFY_REAUTH_REQUIRED: Refresh token expired — merchant must reinstall the app",
    );
  }

  if (!isAccessTokenStale(accessExpiresMs)) {
    const creds = shopToCredentials(shop);
    if (creds) cacheCredentials(shopId, creds);
    return creds;
  }

  log.info("shopify_token_refresh_start", { shopId });
  const refreshed = await refreshExpiringToken(
    shop.shop_domain,
    shop.refresh_token,
  );
  await saveShopOAuthTokens(shopId, refreshed);
  invalidateShopTokenCache(shopId);
  log.info("shopify_token_refreshed", { shopId });
  const creds = shopToCredentials({
    shop_domain: shop.shop_domain,
    access_token: refreshed.accessToken,
    scope: refreshed.scope,
    refresh_token: refreshed.refreshToken,
    access_token_expires_at: refreshed.accessTokenExpiresAtMs
      ? Timestamp.fromMillis(refreshed.accessTokenExpiresAtMs)
      : undefined,
  });
  if (creds) cacheCredentials(shopId, creds);
  return creds;
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

  const work = resolveShopCredentials(id).finally(() => {
    tokenLocks.delete(id);
  });
  tokenLocks.set(id, work);
  return work;
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
