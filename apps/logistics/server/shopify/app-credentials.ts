import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { runtimeEnv } from "@/lib/runtime-env";
import { getShop } from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";

/** Pending custom-app credentials are only valid for the OAuth round-trip. */
export const PENDING_APP_TTL_MS = 30 * 60 * 1000;

export type ShopifyAppCreds = { apiKey: string; apiSecret: string };

export function parseShopifyAppCredentials(
  clientId: string,
  clientSecret: string,
): ShopifyAppCreds | null {
  const apiKey = clientId.trim();
  const apiSecret = clientSecret.trim();
  if (apiKey.length < 8 || apiKey.length > 128 || /\s/.test(apiKey)) return null;
  if (apiSecret.length < 10 || apiSecret.length > 256 || /\s/.test(apiSecret)) {
    return null;
  }
  return { apiKey, apiSecret };
}

export function readEnvAppCreds(): ShopifyAppCreds | null {
  const apiKey = runtimeEnv("SHOPIFY_API_KEY")?.trim();
  const apiSecret = runtimeEnv("SHOPIFY_API_SECRET")?.trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

type PendingDoc = {
  client_id?: string;
  client_secret?: string;
  owner_uid?: string;
  created_at_ms?: number;
};

function pendingRef(shopId: string) {
  return adminDb()
    .collection(Collections.ShopifyPendingApps)
    .doc(normalizeShopId(shopId));
}

export async function savePendingShopifyApp(input: {
  shopId: string;
  ownerUid: string;
  creds: ShopifyAppCreds;
}): Promise<void> {
  await pendingRef(input.shopId).set({
    client_id: input.creds.apiKey,
    client_secret: input.creds.apiSecret,
    owner_uid: input.ownerUid,
    created_at_ms: Date.now(),
  });
}

export async function deletePendingShopifyApp(shopId: string): Promise<void> {
  await pendingRef(shopId).delete();
}

async function readPending(shopId: string): Promise<PendingDoc | null> {
  const snap = await pendingRef(shopId).get();
  if (!snap.exists) return null;
  return (snap.data() ?? null) as PendingDoc | null;
}

function pendingToCreds(doc: PendingDoc | null): ShopifyAppCreds | null {
  if (!doc?.client_id || !doc.client_secret) return null;
  if (typeof doc.created_at_ms !== "number") return null;
  if (Date.now() - doc.created_at_ms > PENDING_APP_TTL_MS) return null;
  return { apiKey: doc.client_id, apiSecret: doc.client_secret };
}

/** Fresh credentials this merchant just entered, before the shop doc exists. */
export async function loadPendingShopifyAppForUser(
  shopId: string,
  uid: string,
): Promise<ShopifyAppCreds | null> {
  const doc = await readPending(shopId);
  if (!doc || doc.owner_uid !== uid) return null;
  return pendingToCreds(doc);
}

export async function loadShopAppCreds(
  shopId: string,
): Promise<ShopifyAppCreds | null> {
  const shop = await getShop(shopId);
  if (!shop?.shopify_client_id || !shop.shopify_client_secret) return null;
  return {
    apiKey: shop.shopify_client_id,
    apiSecret: shop.shopify_client_secret,
  };
}

/** Client id/secret used to start the authorize redirect. */
export async function resolveInstallAppCreds(
  shopId: string,
  uid: string,
): Promise<ShopifyAppCreds | null> {
  return (
    (await loadPendingShopifyAppForUser(shopId, uid)) ??
    (await loadShopAppCreds(shopId)) ??
    readEnvAppCreds()
  );
}

/**
 * Secrets that may have signed this shop's OAuth callback.
 * Pending (just entered) wins over stored shop creds, then env.
 */
export async function appCredCandidates(
  shopId: string,
): Promise<ShopifyAppCreds[]> {
  const pending = pendingToCreds(await readPending(shopId));
  const stored = await loadShopAppCreds(shopId);
  const env = readEnvAppCreds();
  const all = [pending, stored, env].filter((c): c is ShopifyAppCreds => !!c);
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${c.apiKey}\0${c.apiSecret}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Token refresh/migration: per-shop custom app, then the shared env app. */
export async function loadAppCredsForTokenRefresh(
  shopDomain: string,
): Promise<ShopifyAppCreds> {
  const stored = await loadShopAppCreds(shopDomain);
  if (stored) return stored;
  const env = readEnvAppCreds();
  if (env) return env;
  throw new Error(
    "Shopify app credentials missing for this shop — re-enter Client ID and Secret",
  );
}
