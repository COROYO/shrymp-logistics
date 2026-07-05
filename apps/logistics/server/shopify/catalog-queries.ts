import "server-only";
import { shopifyGraphQL } from "./client";
import { numericIdFromGid } from "./sync";
import { mapShopifyProductToEditorInput } from "./catalog-mapper";
import { fetchAllProductMetafields } from "./catalog-metafields";
import type { ShopifyCatalogProductNode } from "./catalog-sync-types";
import type {
  CollectionOption,
  ProductEditorFormInput,
  ProductEditorInput,
} from "@/server/catalog/editor-types";

const PRODUCT_DETAIL_QUERY = /* GraphQL */ `
  query ProductDetail($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      updatedAt
      hasVariantsThatRequiresComponents
      descriptionHtml
      vendor
      productType
      tags
      seo {
        title
        description
      }
      options {
        id
        name
        position
        values
      }
      collections(first: 50) {
        nodes {
          id
          title
        }
      }
      media(first: 20) {
        nodes {
          ... on MediaImage {
            id
            alt
            image {
              url
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
          inventoryItem {
            id
            sku
            tracked
            unitCost {
              amount
            }
          }
          image {
            url
          }
        }
      }
      featuredMedia {
        preview {
          image {
            url
          }
        }
      }
    }
  }
`;

const COLLECTIONS_PAGE_QUERY = /* GraphQL */ `
  query CollectionsPage($cursor: String) {
    collections(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
      }
    }
  }
`;

type ProductDetailInput = ProductEditorFormInput;

export type { ProductDetailInput };

export async function fetchShopifyProductDetail(
  productGid: string,
  shopId?: string,
): Promise<ProductEditorFormInput | null> {
  const data = await shopifyGraphQL<{
    product: ShopifyCatalogProductNode | null;
  }>(PRODUCT_DETAIL_QUERY, { id: productGid }, shopId ? { shopId } : undefined);

  const p = data.product;
  if (!p) return null;
  const allMetafields = await fetchAllProductMetafields(productGid, shopId);
  return mapShopifyProductToEditorInput({
    ...p,
    metafields: { nodes: allMetafields },
  });
}

export async function listShopifyCollections(
  shopId?: string,
): Promise<CollectionOption[]> {
  const out: CollectionOption[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const data: {
      collections: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; title: string; handle: string }>;
      };
    } = await shopifyGraphQL(
      COLLECTIONS_PAGE_QUERY,
      { cursor },
      shopId ? { shopId } : undefined,
    );
    for (const c of data.collections.nodes) {
      out.push({
        id: numericIdFromGid(c.id),
        shopify_gid: c.id,
        title: c.title,
        handle: c.handle,
      });
    }
    if (!data.collections.pageInfo.hasNextPage) break;
    cursor = data.collections.pageInfo.endCursor;
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export type ShopifyPushVariantResult = {
  shopifyGid: string;
  inventoryItemGid: string | null;
};

export type ShopifyPushProductResult = {
  productGid: string;
  productId: string;
  handle: string;
  imageUrl: string | null;
  variants: Array<{
    variantId: string;
    shopifyGid: string;
    inventoryItemGid: string | null;
    title: string;
    sku: string | null;
    barcode: string | null;
    priceCents: number | null;
    compareAtPriceCents: number | null;
    imageUrl: string | null;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    position: number;
  }>;
};

export function centsToShopifyPrice(cents: number | null | undefined): string | undefined {
  if (cents == null) return undefined;
  return (cents / 100).toFixed(2);
}

export function toProductGid(idOrGid: string): string {
  if (idOrGid.startsWith("gid://")) return idOrGid;
  return `gid://shopify/Product/${idOrGid}`;
}

export function toVariantGid(idOrGid: string): string {
  if (idOrGid.startsWith("gid://")) return idOrGid;
  return `gid://shopify/ProductVariant/${idOrGid}`;
}

export function toCollectionGid(idOrGid: string): string {
  if (idOrGid.startsWith("gid://")) return idOrGid;
  return `gid://shopify/Collection/${idOrGid}`;
}
