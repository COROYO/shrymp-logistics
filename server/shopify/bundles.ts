import "server-only";
import { shopifyGraphQL } from "./client";
import { numericIdFromGid } from "./sync";
import type { OrderLineItemBundle } from "@/server/firestore/schema";

/**
 * Shopify only exposes `LineItemGroup` (bundle parent) on the GraphQL Admin
 * API. The REST-shaped webhook payload doesn't carry it, so after mirroring
 * an order from a webhook we re-fetch via GraphQL to enrich each line item
 * with its bundle parent (if any).
 *
 * Returns a map from numeric line-item id → bundle info. Line items that are
 * not part of a bundle are absent from the map.
 */

const ORDER_BUNDLE_QUERY = /* GraphQL */ `
  query OrderBundles($id: ID!) {
    order(id: $id) {
      lineItems(first: 250) {
        nodes {
          id
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

type OrderBundleQueryResponse = {
  order: {
    lineItems: {
      nodes: Array<{
        id: string;
        lineItemGroup: {
          id: string;
          productId: string | null;
          variantId: string | null;
          variantSku: string | null;
          title: string;
          quantity: number;
        } | null;
      }>;
    };
  } | null;
};

export async function fetchOrderBundleGroups(
  orderGid: string,
): Promise<Map<string, OrderLineItemBundle>> {
  const data = await shopifyGraphQL<OrderBundleQueryResponse>(
    ORDER_BUNDLE_QUERY,
    { id: orderGid },
  );
  const out = new Map<string, OrderLineItemBundle>();
  if (!data.order) return out;
  for (const li of data.order.lineItems.nodes) {
    const g = li.lineItemGroup;
    if (!g) continue;
    out.set(numericIdFromGid(li.id), {
      group_id: numericIdFromGid(g.id),
      product_id: g.productId ? numericIdFromGid(g.productId) : null,
      variant_id: g.variantId ? numericIdFromGid(g.variantId) : null,
      variant_sku: g.variantSku ?? null,
      title: g.title,
      quantity: g.quantity,
    });
  }
  return out;
}
