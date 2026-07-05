import type {
  ProductEditorFormInput,
  ProductEditorVariant,
} from "./editor-types";
import { numericIdFromGid } from "@/server/shopify/sync";
import { filterRealOptions } from "./shopify-catalog-normalize";
import { mergeProductMetafieldValues } from "@/server/shopify/catalog-metafields";

function variantLookupKeys(v: ProductEditorVariant): string[] {
  const keys: string[] = [];
  if (v.id) keys.push(v.id);
  if (v.shopify_gid && !v.shopify_gid.startsWith("local://")) {
    keys.push(v.shopify_gid);
    keys.push(numericIdFromGid(v.shopify_gid));
  }
  return keys;
}

function indexVariantsByKey(
  variants: ProductEditorVariant[],
): Map<string, ProductEditorVariant> {
  const map = new Map<string, ProductEditorVariant>();
  for (const v of variants) {
    for (const key of variantLookupKeys(v)) {
      map.set(key, v);
    }
  }
  return map;
}

function findRemoteVariant(
  local: ProductEditorVariant,
  remoteByKey: Map<string, ProductEditorVariant>,
  remoteVariants: ProductEditorVariant[],
  index: number,
): ProductEditorVariant | undefined {
  for (const key of variantLookupKeys(local)) {
    const hit = remoteByKey.get(key);
    if (hit) return hit;
  }
  return remoteVariants[index];
}

function mergeVariantFromShopify(
  local: ProductEditorVariant,
  remote: ProductEditorVariant,
): ProductEditorVariant {
  return {
    ...remote,
    id: local.id ?? remote.id,
    shopify_gid: local.shopify_gid ?? remote.shopify_gid,
    on_hand: local.on_hand,
  };
}

/** Overlay live Shopify catalog data onto Firestore-backed editor state. */
export function mergeEditorInputWithShopify(
  local: ProductEditorFormInput,
  shopify: ProductEditorFormInput,
): ProductEditorFormInput {
  const remoteByKey = indexVariantsByKey(shopify.variants);
  const variants =
    local.variants.length > 0
      ? local.variants.map((lv, index) => {
          const remote = findRemoteVariant(lv, remoteByKey, shopify.variants, index);
          return remote ? mergeVariantFromShopify(lv, remote) : lv;
        })
      : shopify.variants;

  return {
    title: local.title || shopify.title,
    handle: local.handle || shopify.handle,
    status: local.status,
    description_html: shopify.description_html ?? local.description_html,
    vendor: shopify.vendor ?? local.vendor,
    product_type: shopify.product_type ?? local.product_type,
    tags: shopify.tags.length > 0 ? shopify.tags : local.tags,
    seo_title: shopify.seo_title ?? local.seo_title,
    seo_description: shopify.seo_description ?? local.seo_description,
    collection_ids:
      shopify.collection_ids.length > 0
        ? shopify.collection_ids
        : local.collection_ids,
    media: shopify.media.length > 0 ? shopify.media : local.media,
    options: filterRealOptions(shopify.options),
    metafields: mergeProductMetafieldValues(local.metafields, shopify.metafields),
    variants,
  };
}
