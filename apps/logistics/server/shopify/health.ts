import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { shopifyGraphQL } from "./client";
import { ensureWebhookSubscription } from "./mutations";
import { TOPICS } from "./topics";
import { log } from "@/lib/logger";
import { normalizeShopId } from "@/server/tenant/id";

/**
 * Shopify connection health check + auto-heal.
 *
 * What can break:
 *   - Token missing/revoked → only the shop owner can re-OAuth, we log + alert
 *   - Webhook subscription missing → we re-register transparently
 *   - Subscription pointing to old callback URL (e.g. after redeploy with a
 *     new domain) → we delete the stale one and create a fresh one
 *
 * Status writes to `config/shopify_health` so the admin UI can show it live
 * without re-running the check on every page view.
 */

const HEALTH_DOC_ID = "shopify_health";

const TOPIC_ENUM_BY_DOT: Record<string, string> = {
  [TOPICS.ORDERS_CREATE]: "ORDERS_CREATE",
  [TOPICS.ORDERS_UPDATED]: "ORDERS_UPDATED",
  [TOPICS.ORDERS_EDITED]: "ORDERS_EDITED",
  [TOPICS.ORDERS_CANCELLED]: "ORDERS_CANCELLED",
  [TOPICS.INVENTORY_LEVELS_UPDATE]: "INVENTORY_LEVELS_UPDATE",
  [TOPICS.APP_UNINSTALLED]: "APP_UNINSTALLED",
};

export type HealthCheckResult = {
  ok: boolean;
  checkedAt: string; // ISO
  shop: string | null;
  tokenValid: boolean;
  webhooks: Array<{
    topic: string;
    present: boolean;
    callbackUrl: string | null;
    expected: string;
    repaired?: boolean;
  }>;
  errors: string[];
};

const SHOP_PING_QUERY = /* GraphQL */ `
  query Ping {
    shop {
      name
      myshopifyDomain
    }
  }
`;

const WEBHOOKS_QUERY = /* GraphQL */ `
  query Webhooks {
    webhookSubscriptions(first: 50) {
      nodes {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
`;

/**
 * Run the full health check. When `autoHeal: true` (default), missing or
 * misrouted webhook subscriptions are re-registered against the expected
 * callback URL.
 */
export async function checkShopifyHealth(
  opts: { autoHeal?: boolean; baseUrl?: string; shopId?: string } = {},
): Promise<HealthCheckResult> {
  const autoHeal = opts.autoHeal !== false;
  const shopId = opts.shopId;
  const baseUrl = (opts.baseUrl ?? process.env.APP_BASE_URL ?? "").replace(
    /\/$/,
    "",
  );
  const expectedCallback = baseUrl
    ? `${baseUrl}/api/webhooks/shopify`
    : null;

  const result: HealthCheckResult = {
    ok: true,
    checkedAt: new Date().toISOString(),
    shop: null,
    tokenValid: false,
    webhooks: [],
    errors: [],
  };

  // 1. Token check — cheap query against Shopify
  try {
    const data = await shopifyGraphQL<{
      shop: { name: string; myshopifyDomain: string };
    }>(SHOP_PING_QUERY, undefined, shopId ? { shopId } : undefined);
    result.tokenValid = true;
    result.shop = data.shop.myshopifyDomain;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`token_check_failed: ${msg}`);
    result.ok = false;
    // Don't continue with webhook checks if we can't even ping the shop.
    await persistHealth(result, shopId);
    return result;
  }

  // 2. Webhook check
  if (!expectedCallback) {
    result.errors.push("missing_app_base_url");
    result.ok = false;
    await persistHealth(result, shopId);
    return result;
  }

  let existingSubs: Array<{
    id: string;
    topic: string;
    callbackUrl: string | null;
  }> = [];
  try {
    const data = await shopifyGraphQL<{
      webhookSubscriptions: {
        nodes: Array<{
          id: string;
          topic: string;
          endpoint: { __typename: string; callbackUrl?: string };
        }>;
      };
    }>(WEBHOOKS_QUERY, undefined, shopId ? { shopId } : undefined);
    existingSubs = data.webhookSubscriptions.nodes.map((n) => ({
      id: n.id,
      topic: n.topic,
      callbackUrl:
        n.endpoint.__typename === "WebhookHttpEndpoint"
          ? (n.endpoint.callbackUrl ?? null)
          : null,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`webhooks_query_failed: ${msg}`);
    result.ok = false;
    await persistHealth(result, shopId);
    return result;
  }

  for (const dotTopic of Object.values(TOPICS)) {
    const enumTopic = TOPIC_ENUM_BY_DOT[dotTopic];
    if (!enumTopic) continue;
    const match = existingSubs.find(
      (s) => s.topic === enumTopic && s.callbackUrl === expectedCallback,
    );
    const entry: HealthCheckResult["webhooks"][number] = {
      topic: enumTopic,
      present: !!match,
      callbackUrl: match?.callbackUrl ?? null,
      expected: expectedCallback,
    };

    if (!match) {
      result.ok = false;
      if (autoHeal) {
        try {
          await ensureWebhookSubscription(enumTopic, expectedCallback);
          entry.repaired = true;
          entry.present = true;
          entry.callbackUrl = expectedCallback;
          log.info("shopify_webhook_repaired", { topic: enumTopic });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`repair_failed:${enumTopic}: ${msg}`);
        }
      }
    }
    result.webhooks.push(entry);
  }

  // After auto-heal, recompute overall ok-ness so the UI reflects post-repair.
  if (autoHeal) {
    const allRepaired = result.webhooks.every((w) => w.present);
    if (allRepaired && result.tokenValid && result.errors.length === 0) {
      result.ok = true;
    }
  }

  await persistHealth(result, shopId);
  return result;
}

function healthDocId(shopId?: string): string {
  if (!shopId) return HEALTH_DOC_ID;
  return `shopify_health_${normalizeShopId(shopId).replace(/\./g, "_")}`;
}

async function persistHealth(
  r: HealthCheckResult,
  shopId?: string,
): Promise<void> {
  try {
    await adminDb()
      .collection(Collections.Config)
      .doc(healthDocId(shopId))
      .set(
        {
          ...r,
          checkedAt: Timestamp.fromDate(new Date(r.checkedAt)),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (e) {
    log.warn("shopify_health_persist_failed", { error: String(e) });
  }
}

export async function readLastHealth(
  shopId?: string,
): Promise<(HealthCheckResult & { checkedAt: string }) | null> {
  const snap = await adminDb()
    .collection(Collections.Config)
    .doc(healthDocId(shopId))
    .get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  const ts = d.checkedAt as { toDate?(): Date } | undefined;
  return {
    ok: !!d.ok,
    checkedAt:
      ts && typeof ts.toDate === "function"
        ? ts.toDate().toISOString()
        : (d.checkedAt as string) ?? new Date().toISOString(),
    shop: (d.shop as string | null) ?? null,
    tokenValid: !!d.tokenValid,
    webhooks: (d.webhooks as HealthCheckResult["webhooks"]) ?? [],
    errors: (d.errors as string[]) ?? [],
  };
}

export { HEALTH_DOC_ID };
