import "server-only";
import { ensureWebhookSubscription } from "./mutations";
import { TOPICS } from "./topics";
import { log } from "@/lib/logger";

const TOPIC_ENUM_BY_DOT: Record<string, string> = {
  [TOPICS.ORDERS_CREATE]: "ORDERS_CREATE",
  [TOPICS.ORDERS_UPDATED]: "ORDERS_UPDATED",
  [TOPICS.ORDERS_EDITED]: "ORDERS_EDITED",
  [TOPICS.ORDERS_CANCELLED]: "ORDERS_CANCELLED",
  [TOPICS.INVENTORY_LEVELS_UPDATE]: "INVENTORY_LEVELS_UPDATE",
  [TOPICS.APP_UNINSTALLED]: "APP_UNINSTALLED",
};

export type WebhookRegistrationResult = {
  topic: string;
  created: boolean;
  id: string;
};

/**
 * Register all required Shopify webhook subscriptions for a shop.
 * Idempotent — existing matching subscriptions are reused.
 */
export async function registerAllWebhooks(
  shopId: string,
  callbackUrl: string,
): Promise<WebhookRegistrationResult[]> {
  const results: WebhookRegistrationResult[] = [];
  for (const dotTopic of Object.values(TOPICS)) {
    const enumTopic = TOPIC_ENUM_BY_DOT[dotTopic];
    if (!enumTopic) continue;
    const r = await ensureWebhookSubscription(enumTopic, callbackUrl, shopId);
    results.push({ topic: enumTopic, ...r });
  }
  log.info("shopify_webhooks_registered", {
    shopId,
    created: results.filter((r) => r.created).map((r) => r.topic),
  });
  return results;
}

export { TOPIC_ENUM_BY_DOT };
