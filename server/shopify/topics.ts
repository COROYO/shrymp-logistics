/**
 * Shopify webhook topics we subscribe to.
 *
 * Topic header format is dot-separated (e.g. `orders/create`);
 * `webhookSubscriptionCreate` accepts the SCREAMING_SNAKE enum value.
 */

export const TOPICS = {
  ORDERS_CREATE: "orders/create",
  ORDERS_UPDATED: "orders/updated",
  ORDERS_CANCELLED: "orders/cancelled",
  INVENTORY_LEVELS_UPDATE: "inventory_levels/update",
  APP_UNINSTALLED: "app/uninstalled",
} as const;

export type ShopifyTopic = (typeof TOPICS)[keyof typeof TOPICS];

export const SUPPORTED_TOPICS = Object.values(TOPICS) as ShopifyTopic[];

export function isSupportedTopic(s: string | null): s is ShopifyTopic {
  return !!s && (SUPPORTED_TOPICS as string[]).includes(s);
}
