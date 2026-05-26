import "server-only";
import { shopifyGraphQL } from "./client";

/**
 * Read queries against the Shopify Admin GraphQL API.
 * Pagination-aware where applicable.
 */

const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query ProductsPage($cursor: String, $pageSize: Int!) {
    products(first: $pageSize, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        status
        updatedAt
        variants(first: 100) {
          nodes {
            id
            title
            sku
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

export type ShopifyProductNode = {
  id: string;
  title: string;
  handle: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  updatedAt: string;
  variants: { nodes: ShopifyVariantNode[] };
};

export type ShopifyVariantNode = {
  id: string;
  title: string;
  sku: string | null;
  inventoryItem: { id: string } | null;
};

type ProductsPageResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyProductNode[];
  };
};

export async function* iterateAllProducts(
  pageSize = 50,
): AsyncGenerator<ShopifyProductNode> {
  let cursor: string | null = null;
  // Guard against runaway pagination.
  for (let i = 0; i < 1000; i++) {
    const data: ProductsPageResponse = await shopifyGraphQL<ProductsPageResponse>(
      PRODUCTS_PAGE_QUERY,
      { cursor, pageSize },
    );

    for (const p of data.products.nodes) yield p;

    if (!data.products.pageInfo.hasNextPage) return;
    cursor = data.products.pageInfo.endCursor;
  }
  throw new Error("iterateAllProducts: too many pages (>1000)");
}

// ----------------------- Locations -----------------------

const LOCATIONS_QUERY = /* GraphQL */ `
  query Locations {
    locations(first: 10, includeInactive: false) {
      nodes {
        id
        name
        isPrimary
        fulfillsOnlineOrders
      }
    }
  }
`;

export type ShopifyLocationNode = {
  id: string;
  name: string;
  isPrimary: boolean;
  fulfillsOnlineOrders: boolean;
};

export async function getActiveLocations(): Promise<ShopifyLocationNode[]> {
  const data = await shopifyGraphQL<{
    locations: { nodes: ShopifyLocationNode[] };
  }>(LOCATIONS_QUERY);
  return data.locations.nodes;
}

/**
 * Pick a single fulfillment location to use for inventory pushes.
 * Prefers `isPrimary` && `fulfillsOnlineOrders`. Falls back to the first
 * online-fulfilling location. Throws if none exists.
 */
export async function resolvePrimaryFulfillmentLocation(): Promise<ShopifyLocationNode> {
  const locs = await getActiveLocations();
  const primary = locs.find((l) => l.isPrimary && l.fulfillsOnlineOrders);
  if (primary) return primary;
  const fallback = locs.find((l) => l.fulfillsOnlineOrders);
  if (fallback) return fallback;
  throw new Error("No active fulfillment location found in Shopify shop");
}
