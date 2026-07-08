import "server-only";
import type { ProductEditorInput, ProductEditorVariant } from "@/server/catalog/editor-types";
import type { ShopifyPushProductResult } from "@/server/shopify/catalog-queries";
import { toVariantGid } from "@/server/shopify/catalog-queries";
import type { Variant } from "@/server/firestore/schema";
import { numericIdFromGid } from "@/server/shopify/sync";
import { variantOptionKey } from "./variant-matrix";

export function variantLookupKeys(
  v: Pick<ProductEditorVariant, "id" | "shopify_gid">,
): string[] {
  const keys: string[] = [];
  if (v.id) keys.push(v.id);
  if (v.shopify_gid && !v.shopify_gid.startsWith("local://")) {
    keys.push(v.shopify_gid);
    keys.push(numericIdFromGid(v.shopify_gid));
  }
  return keys;
}

function variantFromDb(doc: Variant): ProductEditorVariant {
  return {
    id: doc.id,
    shopify_gid: doc.shopify_gid,
    title: doc.title,
    sku: doc.sku,
    barcode: doc.barcode,
    price_cents: doc.price_cents,
    compare_at_price_cents: doc.compare_at_price_cents,
    image_url: doc.image_url,
    option1: doc.option1,
    option2: doc.option2,
    option3: doc.option3,
    position: doc.position ?? 0,
    on_hand: doc.on_hand_total ?? 0,
    inventory_tracked: doc.inventory_tracked ?? true,
    inventory_policy: doc.inventory_policy ?? "DENY",
    unit_cost_cents: doc.unit_cost_cents ?? null,
  };
}

/** Merge editor patches onto matching DB rows without adding orphan DB variants. */
export function mergeEditorVariantsWithDb(
  dbVariants: Variant[],
  editorVariants: ProductEditorVariant[],
): ProductEditorVariant[] {
  if (dbVariants.length === 0) return editorVariants;

  const dbByKey = new Map<string, Variant>();
  for (const doc of dbVariants) {
    for (const key of variantLookupKeys(doc)) {
      dbByKey.set(key, doc);
    }
  }

  return editorVariants.map((variant) => {
    let doc: Variant | undefined;
    for (const key of variantLookupKeys(variant)) {
      doc = dbByKey.get(key);
      if (doc) break;
    }
    if (!doc) return variant;
    return {
      ...variantFromDb(doc),
      ...variant,
      id: doc.id,
      shopify_gid: doc.shopify_gid,
    };
  });
}

export function applyPushVariantGids(
  input: ProductEditorInput,
  pushed: ShopifyPushProductResult["variants"],
): ProductEditorInput {
  const byGid = new Map(pushed.map((row) => [row.shopifyGid, row]));
  const byOptionKey = new Map(
    pushed.map((row) => [
      variantOptionKey({
        option1: row.option1,
        option2: row.option2,
        option3: row.option3,
      }),
      row,
    ]),
  );

  return {
    ...input,
    variants: input.variants.map((variant) => {
      const gid = variant.shopify_gid?.startsWith("local://")
        ? null
        : variant.shopify_gid
          ? toVariantGid(variant.shopify_gid)
          : null;
      const row =
        (gid ? byGid.get(gid) : undefined) ??
        byOptionKey.get(variantOptionKey(variant));
      if (!row) return variant;
      return {
        ...variant,
        id: variant.id ?? row.variantId,
        shopify_gid: row.shopifyGid,
      };
    }),
  };
}

export function mergeVariantImagesFromSource(
  target: ProductEditorInput,
  source: ProductEditorInput,
): ProductEditorInput {
  const imagesByOption = new Map(
    source.variants.map((v) => [
      variantOptionKey(v),
      {
        image_url: v.image_url ?? null,
        image_media_id: v.image_media_id ?? null,
      },
    ]),
  );

  return {
    ...target,
    variants: target.variants.map((variant) => {
      const images = imagesByOption.get(variantOptionKey(variant));
      return images ? { ...variant, ...images } : variant;
    }),
  };
}

/** Map Shopify push result back onto app variant docs (by option combo, then Shopify GID). */
export function mapPushVariantsToFirestore(
  editorVariants: ProductEditorVariant[],
  pushed: ShopifyPushProductResult["variants"],
) {
  const byGid = new Map<string, ProductEditorVariant>();
  const byOptionKey = new Map<string, ProductEditorVariant>();
  for (const variant of editorVariants) {
    byOptionKey.set(variantOptionKey(variant), variant);
    if (variant.shopify_gid && !variant.shopify_gid.startsWith("local://")) {
      byGid.set(toVariantGid(variant.shopify_gid), variant);
    }
  }

  return pushed.map((row) => {
    const editor =
      byGid.get(row.shopifyGid) ??
      byOptionKey.get(
        variantOptionKey({
          option1: row.option1,
          option2: row.option2,
          option3: row.option3,
        }),
      );

    return {
      variantId: editor?.id ?? row.variantId,
      shopifyGid: row.shopifyGid,
      inventoryItemGid: row.inventoryItemGid,
      title: row.title,
      sku: row.sku,
      barcode: row.barcode,
      priceCents: row.priceCents,
      compareAtPriceCents: row.compareAtPriceCents,
      imageUrl: row.imageUrl,
      option1: row.option1,
      option2: row.option2,
      option3: row.option3,
      position: row.position,
      onHand: editor?.on_hand ?? 0,
      inventoryTracked: editor?.inventory_tracked ?? true,
      inventoryPolicy: editor?.inventory_policy ?? "DENY",
      unitCostCents: editor?.unit_cost_cents ?? null,
    };
  });
}
