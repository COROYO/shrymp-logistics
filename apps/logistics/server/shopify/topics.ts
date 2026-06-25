/**
 * Shopify webhook topics we subscribe to.
 *
 * Topic header format is dot-separated (e.g. `orders/create`);
 * `webhookSubscriptionCreate` accepts the SCREAMING_SNAKE enum value.
 */

export const TOPICS = {
  ORDERS_CREATE: "orders/create",
  ORDERS_UPDATED: "orders/updated",
  /**
   * Fires specifically on Order Editing API changes (add/remove items via
   * Shopify's "Edit order" button). `orders/updated` *usually* also fires
   * for the same event, but not always — and even when it does, the REST
   * payload `line_items` array is misleading on edits (removed items stay
   * present with `current_quantity: 0`). We re-fetch via GraphQL on both
   * topics to get the canonical current line items.
   */
  ORDERS_EDITED: "orders/edited",
  ORDERS_CANCELLED: "orders/cancelled",
  INVENTORY_LEVELS_UPDATE: "inventory_levels/update",
  APP_UNINSTALLED: "app/uninstalled",
} as const;

export type ShopifyTopic = (typeof TOPICS)[keyof typeof TOPICS];

export const SUPPORTED_TOPICS = Object.values(TOPICS) as ShopifyTopic[];

export function isSupportedTopic(s: string | null): s is ShopifyTopic {
  return !!s && (SUPPORTED_TOPICS as string[]).includes(s);
}
