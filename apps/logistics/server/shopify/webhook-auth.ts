import "server-only";
import { log } from "@/lib/logger";
import { verifyShopifyHmac } from "./hmac";
import { loadShopAppCreds, readEnvAppCreds } from "./app-credentials";

export type WebhookAuth = "ok" | "invalid" | "misconfigured" | "unavailable";

/**
 * `storedSecret === undefined` means the per-shop secret has not been loaded
 * yet. Env is checked first so a burst never waits on Firestore when the
 * shared app secret already verifies.
 */
export function classifyWebhookHmac(input: {
  rawBody: string;
  signature: string | null;
  envSecret: string | null;
  storedSecret: string | null | undefined;
}): "ok" | "invalid" | "misconfigured" | "need_stored" {
  const { rawBody, signature, envSecret, storedSecret } = input;
  if (envSecret && verifyShopifyHmac(rawBody, signature, envSecret)) return "ok";
  if (storedSecret === undefined) return "need_stored";
  if (storedSecret && verifyShopifyHmac(rawBody, signature, storedSecret)) {
    return "ok";
  }
  if (!envSecret && !storedSecret) return "misconfigured";
  return "invalid";
}

const SECRET_TTL_MS = 5 * 60 * 1000;
const CREDS_TIMEOUT_MS = 800;

type CacheEntry = { secret: string | null; at: number };
const secretCache = new Map<string, CacheEntry>();

function cacheKey(shop: string): string {
  return shop.trim().toLowerCase();
}

async function loadStoredSecret(shop: string): Promise<string | null> {
  const key = cacheKey(shop);
  const cached = secretCache.get(key);
  if (cached && Date.now() - cached.at < SECRET_TTL_MS) return cached.secret;

  const stored = await loadShopAppCreds(shop);
  const secret = stored?.apiSecret ?? null;
  // Don't cache a miss — a secret saved during onboarding must apply on the
  // next delivery. Hits are the hot path during an inventory burst.
  if (secret) secretCache.set(key, { secret, at: Date.now() });
  return secret;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Verify the Shopify HMAC. The env app secret is tried with no I/O.
 * A per-shop custom-app secret is loaded only on mismatch, from a short
 * memory cache, and bounded so a stuck Firestore read cannot eat Shopify's
 * 5s budget.
 */
export async function authorizeShopifyWebhook(
  rawBody: string,
  signature: string | null,
  shop: string | null,
): Promise<WebhookAuth> {
  const envSecret = readEnvAppCreds()?.apiSecret ?? null;
  const first = classifyWebhookHmac({
    rawBody,
    signature,
    envSecret,
    storedSecret: shop ? undefined : null,
  });
  if (first !== "need_stored") return first;
  if (!shop) return "invalid";

  let storedSecret: string | null;
  try {
    storedSecret = await withTimeout(loadStoredSecret(shop), CREDS_TIMEOUT_MS);
  } catch (e) {
    log.error("shopify_webhook_creds_lookup_failed", {
      shop,
      error: e instanceof Error ? e.message : String(e),
    });
    return "unavailable";
  }

  const second = classifyWebhookHmac({
    rawBody,
    signature,
    envSecret,
    storedSecret,
  });
  return second === "need_stored" ? "invalid" : second;
}
