import "server-only";
import { shopifyGraphQL } from "./client";
import type { ShopifyCatalogProductNode } from "./catalog-sync-types";

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
        descriptionHtml
        vendor
        productType
        tags
        hasVariantsThatRequiresComponents
        seo {
          title
          description
        }
        options {
          name
          position
          values
        }
        collections(first: 20) {
          nodes {
            id
          }
        }
        media(first: 10) {
          nodes {
            ... on MediaImage {
              id
              alt
              image {
                url(transform: { maxWidth: 800, maxHeight: 800 })
              }
            }
          }
        }
        metafields(first: 250) {
          nodes {
            namespace
            key
            value
            jsonValue
            type
          }
        }
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 400, maxHeight: 400 })
            }
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            price
            compareAtPrice
            inventoryPolicy
            inventoryQuantity
            selectedOptions {
              name
              value
            }
            image {
              url(transform: { maxWidth: 400, maxHeight: 400 })
            }
            inventoryItem {
              id
              sku
              tracked
              unitCost {
                amount
              }
            }
          }
        }
      }
    }
  }
`;

export type ShopifyInventoryLevelNode = {
  location: { id: string };
  quantities: { quantity: number }[];
};

export type ShopifyProductNode = ShopifyCatalogProductNode;

export type ShopifyVariantNode = ShopifyCatalogProductNode["variants"]["nodes"][number];

type ProductsPageResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyProductNode[];
  };
};

export async function fetchProductsPage(
  cursor: string | null = null,
  pageSize = 50,
): Promise<{
  products: ShopifyProductNode[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  const data: ProductsPageResponse = await shopifyGraphQL<ProductsPageResponse>(
    PRODUCTS_PAGE_QUERY,
    { cursor, pageSize },
  );
  return {
    products: data.products.nodes,
    hasNextPage: data.products.pageInfo.hasNextPage,
    endCursor: data.products.pageInfo.endCursor,
  };
}

export async function* iterateAllProducts(
  pageSize = 50,
): AsyncGenerator<ShopifyProductNode> {
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const page = await fetchProductsPage(cursor, pageSize);
    for (const p of page.products) yield p;
    if (!page.hasNextPage) return;
    cursor = page.endCursor;
  }
  throw new Error("iterateAllProducts: too many pages (>1000)");
}

export type VariantLocationAvailable = {
  locationGid: string;
  available: number;
};

/** All location-level available quantities for a variant node (legacy shape with nested levels). */
export function shopifyAvailableByLocationFromVariantNode(
  v: ShopifyVariantNode & {
    inventoryItem?: {
      inventoryLevels?: { nodes: ShopifyInventoryLevelNode[] };
    } | null;
  },
): VariantLocationAvailable[] {
  const levels = v.inventoryItem?.inventoryLevels?.nodes ?? [];
  return parseInventoryLevelNodes(levels);
}

export function parseInventoryLevelNodes(
  levels: ShopifyInventoryLevelNode[],
): VariantLocationAvailable[] {
  const out: VariantLocationAvailable[] = [];
  for (const level of levels) {
    const qty = level.quantities?.[0]?.quantity;
    if (qty == null || !Number.isFinite(qty)) continue;
    out.push({
      locationGid: level.location.id,
      available: Math.max(0, Math.trunc(qty)),
    });
  }
  return out;
}

const INVENTORY_ITEMS_BATCH_QUERY = /* GraphQL */ `
  query InventoryItemsBatch($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        inventoryLevels(first: 25) {
          nodes {
            location {
              id
            }
            quantities(names: ["available"]) {
              quantity
            }
          }
        }
      }
    }
  }
`;

type InventoryItemBatchNode = {
  id: string;
  inventoryLevels?: { nodes: ShopifyInventoryLevelNode[] };
};

/** Fetch per-location available qty in small batches (keeps query cost under Shopify limit). */
const INVENTORY_ITEM_BATCH_SIZE = 25;

export async function* fetchInventoryLevelsByItemGids(
  inventoryItemGids: string[],
): AsyncGenerator<{ inventoryItemGid: string; locations: VariantLocationAvailable[] }> {
  const ids = [...new Set(inventoryItemGids.filter(Boolean))];
  for (let i = 0; i < ids.length; i += INVENTORY_ITEM_BATCH_SIZE) {
    const chunk = ids.slice(i, i + INVENTORY_ITEM_BATCH_SIZE);
    const data = await shopifyGraphQL<{
      nodes: Array<InventoryItemBatchNode | null>;
    }>(INVENTORY_ITEMS_BATCH_QUERY, { ids: chunk });

    for (const node of data.nodes) {
      if (!node?.id) continue;
      yield {
        inventoryItemGid: node.id,
        locations: parseInventoryLevelNodes(node.inventoryLevels?.nodes ?? []),
      };
    }
  }
}

/** @deprecated Use shopifyAvailableByLocationFromVariantNode — sums all locations. */
export function shopifyAvailableFromVariantNode(
  v: ShopifyVariantNode,
): number | null {
  const rows = shopifyAvailableByLocationFromVariantNode(v);
  if (rows.length === 0) return null;
  return rows.reduce((s, r) => s + r.available, 0);
}

// ----------------------- Locations -----------------------

const LOCATIONS_QUERY = /* GraphQL */ `
  query Locations($cursor: String) {
    locations(first: 50, after: $cursor, includeInactive: false) {
      pageInfo {
        hasNextPage
        endCursor
      }
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

type LocationsPageResponse = {
  locations: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyLocationNode[];
  };
};

export async function getActiveLocations(): Promise<ShopifyLocationNode[]> {
  const out: ShopifyLocationNode[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const data: LocationsPageResponse = await shopifyGraphQL<LocationsPageResponse>(
      LOCATIONS_QUERY,
      { cursor },
    );
    out.push(...data.locations.nodes);
    if (!data.locations.pageInfo.hasNextPage) break;
    cursor = data.locations.pageInfo.endCursor;
  }
  return out;
}

export async function resolvePrimaryFulfillmentLocation(): Promise<ShopifyLocationNode> {
  const locs = await getActiveLocations();
  const primary = locs.find((l) => l.isPrimary && l.fulfillsOnlineOrders);
  if (primary) return primary;
  const fallback = locs.find((l) => l.fulfillsOnlineOrders);
  if (fallback) return fallback;
  throw new Error("No active fulfillment location found in Shopify shop");
}
