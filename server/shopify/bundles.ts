import "server-only";
import { shopifyGraphQL } from "./client";
import { numericIdFromGid } from "./sync";
import type {
  OrderLineItem,
  OrderLineItemBundle,
} from "@/server/firestore/schema";

/**
 * GraphQL re-fetch of an order's current line items.
 *
 * Why we don't trust the REST webhook payload's `line_items`:
 *
 *   When an order is edited via Shopify's Order Editing API (the "Edit
 *   order" button in admin), the `orders/updated` REST webhook keeps
 *   removed items in the array with their original `quantity` intact, only
 *   marking them as `current_quantity: 0`. Newly-added items appear as
 *   fresh entries. If we trust `quantity`, we end up showing BOTH the
 *   removed AND the added items.
 *
 *   GraphQL `LineItem.quantity` always reflects the current, post-edit
 *   quantity. So we just re-fetch.
 *
 *   As a bonus, the REST payload doesn't carry `LineItemGroup` (bundle
 *   parent) info, while GraphQL does — so this single fetch covers both
 *   correctness AND bundle enrichment.
 */

const ORDER_LINE_ITEMS_QUERY = /* GraphQL */ `
  query OrderLineItems($id: ID!) {
    order(id: $id) {
      lineItems(first: 250) {
        nodes {
          id
          title
          sku
          quantity
          variant {
            id
          }
          lineItemGroup {
            id
            productId
            variantId
            variantSku
            title
            quantity
          }
        }
      }
    }
  }
`;

type GqlLineItem = {
  id: string;
  title: string;
  sku: string | null;
  quantity: number;
  variant: { id: string } | null;
  lineItemGroup: {
    id: string;
    productId: string | null;
    variantId: string | null;
    variantSku: string | null;
    title: string;
    quantity: number;
  } | null;
};

type OrderLineItemsResponse = {
  order: { lineItems: { nodes: GqlLineItem[] } } | null;
};

/**
 * Fetch the canonical, current-quantity line items for an order.
 *
 * Returns `null` if the order doesn't exist (or GraphQL returned no data),
 * in which case the caller should fall back to whatever they already have
 * (don't blow away the order doc).
 *
 * Line items without a `variant.id` are dropped — same as the REST mapper
 * does — because we can't allocate against them. Items with `quantity = 0`
 * (removed via order edit) are also dropped.
 */
export async function fetchOrderLineItems(
  orderGid: string,
): Promise<OrderLineItem[] | null> {
  const data = await shopifyGraphQL<OrderLineItemsResponse>(
    ORDER_LINE_ITEMS_QUERY,
    { id: orderGid },
  );
  if (!data.order) return null;

  return data.order.lineItems.nodes
    .filter((li) => li.variant?.id && li.quantity > 0)
    .map((li) => {
      const vid = numericIdFromGid(li.variant!.id);
      const g = li.lineItemGroup;
      const item: OrderLineItem = {
        id: numericIdFromGid(li.id),
        variant_id: vid,
        variant_gid: li.variant!.id,
        qty: li.quantity,
        title: li.title,
        sku: li.sku ?? null,
      };
      if (g) {
        item.bundle = {
          group_id: numericIdFromGid(g.id),
          product_id: g.productId ? numericIdFromGid(g.productId) : null,
          variant_id: g.variantId ? numericIdFromGid(g.variantId) : null,
          variant_sku: g.variantSku ?? null,
          title: g.title,
          quantity: g.quantity,
        };
      }
      return item;
    });
}

/**
 * @deprecated Use `fetchOrderLineItems` instead — it returns the full line
 * items (including bundle info) in one round trip and respects current
 * quantities after order edits.
 */
export async function fetchOrderBundleGroups(
  orderGid: string,
): Promise<Map<string, OrderLineItemBundle>> {
  const items = await fetchOrderLineItems(orderGid);
  const out = new Map<string, OrderLineItemBundle>();
  if (!items) return out;
  for (const li of items) {
    if (li.bundle) out.set(li.id, li.bundle);
  }
  return out;
}
