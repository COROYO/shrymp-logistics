import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import {
  filterRealOptions,
  normalizeProductEditorInput,
  resolveVariantSku,
} from "@/server/catalog/shopify-catalog-normalize";
import type { ProductEditorFormInput } from "@/server/catalog/editor-types";
import type {
  ProductMedia,
  ProductMetafield,
  ProductOption,
} from "@/server/firestore/schema";
import { resolveVariantImageMediaId } from "@/lib/variant-image";
import { mapShopifyMetafieldNodes } from "./catalog-metafields";
import { numericIdFromGid, parsePriceToCents, shopifyMoneyToCents } from "./sync";
import type {
  ShopifyCatalogProductNode,
  ShopifyCatalogVariantNode,
} from "./catalog-sync-types";

export function mapShopifyMediaNodes(
  nodes: ShopifyCatalogProductNode["media"]["nodes"],
): ProductMedia[] {
  const out: ProductMedia[] = [];
  nodes.forEach((node, index) => {
    const url = node.image?.url;
    if (!url) return;
    out.push({
      id: node.id,
      url,
      alt: node.alt ?? null,
      position: index,
    });
  });
  return out;
}

export function mapShopifyOptions(
  options: ShopifyCatalogProductNode["options"],
): ProductOption[] {
  return filterRealOptions(
    options.map((o) => ({
      name: o.name,
      position: o.position,
      values: o.values,
    })),
  );
}

export function mapShopifyMetafields(
  nodes: ShopifyCatalogProductNode["metafields"]["nodes"],
): ProductMetafield[] {
  return mapShopifyMetafieldNodes(nodes);
}

export function mapShopifyProductCatalogFields(
  p: ShopifyCatalogProductNode,
  shopId: string,
) {
  const productId = numericIdFromGid(p.id);
  const optionNames = mapShopifyOptions(p.options).map((o) => o.name);

  return {
    productDoc: {
      id: productId,
      shop_id: shopId,
      shopify_gid: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      image_url: p.featuredMedia?.preview?.image?.url ?? null,
      description_html: p.descriptionHtml,
      vendor: p.vendor,
      product_type: p.productType,
      tags: p.tags ?? [],
      seo_title: p.seo?.title ?? null,
      seo_description: p.seo?.description ?? null,
      collection_ids: p.collections.nodes.map((c) => numericIdFromGid(c.id)),
      media: mapShopifyMediaNodes(p.media.nodes),
      options: mapShopifyOptions(p.options),
      metafields: mapShopifyMetafields(p.metafields.nodes),
      is_bundle: p.hasVariantsThatRequiresComponents === true,
      updated_at_shopify: new Date(p.updatedAt),
      synced_at: FieldValue.serverTimestamp(),
    },
    variants: p.variants.nodes.map((v, index) =>
      mapShopifyVariantCatalogFields(v, {
        shopId,
        productId,
        optionNames,
        position: index,
      }),
    ),
  };
}

export function mapShopifyVariantCatalogFields(
  v: ShopifyCatalogVariantNode,
  ctx: {
    shopId: string;
    productId: string;
    optionNames: string[];
    position: number;
  },
) {
  const variantId = numericIdFromGid(v.id);
  const byName = new Map(v.selectedOptions.map((o) => [o.name, o.value]));
  const inventoryItemGid = v.inventoryItem?.id;

  return {
    variantId,
    inventoryItemGid,
    doc: {
      id: variantId,
      shop_id: ctx.shopId,
      product_id: ctx.productId,
      shopify_gid: v.id,
      inventory_item_gid: inventoryItemGid ?? `missing://${variantId}`,
      sku: resolveVariantSku(v),
      barcode: v.barcode ?? null,
      title: v.title,
      image_url: v.image?.url ?? null,
      price_cents: shopifyMoneyToCents(v.price),
      compare_at_price_cents: shopifyMoneyToCents(v.compareAtPrice),
      currency: null,
      option1: ctx.optionNames[0]
        ? (byName.get(ctx.optionNames[0]) ?? null)
        : null,
      option2: ctx.optionNames[1]
        ? (byName.get(ctx.optionNames[1]) ?? null)
        : null,
      option3: ctx.optionNames[2]
        ? (byName.get(ctx.optionNames[2]) ?? null)
        : null,
      position: ctx.position,
      inventory_tracked: v.inventoryItem?.tracked ?? true,
      inventory_policy: v.inventoryPolicy ?? "DENY",
      unit_cost_cents: parsePriceToCents(v.inventoryItem?.unitCost?.amount ?? null),
      updated_at: FieldValue.serverTimestamp(),
    },
  };
}

/** Map a full Shopify product node into editor form input (detail fetch + sync). */
export function mapShopifyProductToEditorInput(
  p: ShopifyCatalogProductNode,
): ProductEditorFormInput {
  const realOptions = mapShopifyOptions(p.options);
  const optionNames = realOptions.map((o) => o.name);
  return normalizeProductEditorInput({
    title: p.title,
    handle: p.handle,
    status: p.status,
    description_html: p.descriptionHtml,
    vendor: p.vendor,
    product_type: p.productType,
    tags: p.tags ?? [],
    seo_title: p.seo?.title ?? null,
    seo_description: p.seo?.description ?? null,
    collection_ids: p.collections.nodes.map((c) => numericIdFromGid(c.id)),
    media: mapShopifyMediaNodes(p.media.nodes).map((m) => ({
      id: m.id,
      url: m.url,
      alt: m.alt,
      position: m.position,
    })),
    options: realOptions,
    metafields: mapShopifyMetafields(p.metafields.nodes),
    variants: p.variants.nodes.map((v, index) => {
      const byName = new Map(v.selectedOptions.map((o) => [o.name, o.value]));
      const gallery = mapShopifyMediaNodes(p.media.nodes);
      const variantImageUrl = v.image?.url ?? null;
      return {
        id: numericIdFromGid(v.id),
        shopify_gid: v.id,
        title: v.title,
        sku: resolveVariantSku(v),
        barcode: v.barcode,
        price_cents: shopifyMoneyToCents(v.price),
        compare_at_price_cents: shopifyMoneyToCents(v.compareAtPrice),
        image_url: variantImageUrl,
        image_media_id: resolveVariantImageMediaId(variantImageUrl, gallery),
        option1: optionNames[0] ? (byName.get(optionNames[0]) ?? null) : null,
        option2: optionNames[1] ? (byName.get(optionNames[1]) ?? null) : null,
        option3: optionNames[2] ? (byName.get(optionNames[2]) ?? null) : null,
        position: index,
        on_hand: Math.max(0, v.inventoryQuantity ?? 0),
        inventory_tracked: v.inventoryItem?.tracked ?? true,
        inventory_policy: v.inventoryPolicy ?? "DENY",
        unit_cost_cents: parsePriceToCents(v.inventoryItem?.unitCost?.amount ?? null),
      };
    }),
  });
}
