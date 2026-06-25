import "server-only";
import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  ConfigDocs,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import {
  iterateAllProducts,
  resolvePrimaryFulfillmentLocation,
} from "./queries";

/**
 * Extract the numeric id at the tail of a Shopify GID:
 *   "gid://shopify/Product/12345" → "12345"
 */
export function numericIdFromGid(gid: string): string {
  const i = gid.lastIndexOf("/");
  if (i < 0) return gid;
  return gid.slice(i + 1);
}

/** Parse Shopify's decimal-string price ("49.90") to integer cents (4990). */
export function parsePriceToCents(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(-?\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = parseInt(m[1] ?? "0", 10);
  const fracPart = m[2] ?? "";
  const frac = parseInt((fracPart + "00").slice(0, 2), 10);
  return whole * 100 + (whole < 0 ? -frac : frac);
}

const FIRESTORE_BATCH_MAX = 450; // hard limit is 500, leave headroom

/**
 * Pull the entire Shopify product catalog into Firestore.
 *
 * Strategy:
 * - Iterate paginated products + their variants.
 * - For each variant, write/merge into `variants/{numericId}`.
 * - For each product, write/merge into `products/{numericId}`.
 * - Do NOT touch `on_hand_total`/`reserved_total`/`available` — those are
 *   owned by us, not Shopify.
 * - Also persists the primary fulfillment location's GID to
 *   `config/shopify_meta` for downstream inventory pushes.
 */
export async function syncProductsAndVariants(
  shopId: string,
): Promise<{
  productCount: number;
  variantCount: number;
  locationGid: string;
}> {
  const { runWithTenantAsync } = await import("@/server/tenant/context");
  const { updateShopMeta } = await import("@/server/tenant/shop");
  const { normalizeShopId } = await import("@/server/tenant/id");
  const normalizedShopId = normalizeShopId(shopId);

  return runWithTenantAsync(normalizedShopId, async () => {
  const db = adminDb();
  const location = await resolvePrimaryFulfillmentLocation();

  await updateShopMeta(normalizedShopId, {
    location_gid: location.id,
    api_version: process.env.SHOPIFY_API_VERSION ?? "2026-04",
  });

  let productCount = 0;
  let variantCount = 0;
  let batch = db.batch();
  let opsInBatch = 0;

  const flush = async (b: WriteBatch) => {
    if (opsInBatch > 0) {
      await b.commit();
    }
  };

  for await (const p of iterateAllProducts()) {
    const productId = numericIdFromGid(p.id);

    const productImage =
      p.featuredMedia?.preview?.image?.url ?? null;

    const productDoc: Omit<Product, "synced_at" | "updated_at_shopify"> & {
      synced_at: FirebaseFirestore.FieldValue;
      updated_at_shopify: Date;
    } = {
      id: productId,
      shop_id: normalizedShopId,
      shopify_gid: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      image_url: productImage,
      is_bundle: p.hasVariantsThatRequiresComponents === true,
      updated_at_shopify: new Date(p.updatedAt),
      synced_at: FieldValue.serverTimestamp(),
    };

    batch.set(
      db.collection(Collections.Products).doc(productId),
      productDoc,
      { merge: true },
    );
    opsInBatch++;
    productCount++;

    for (const v of p.variants.nodes) {
      const variantId = numericIdFromGid(v.id);
      const inventoryItemGid = v.inventoryItem?.id;
      if (!inventoryItemGid) {
        log.warn("variant_without_inventory_item", { variantGid: v.id });
        continue;
      }

      const priceCents = parsePriceToCents(v.price);

      const variantDoc: Omit<
        Variant,
        "updated_at" | "on_hand_total" | "reserved_total" | "available"
      > & {
        updated_at: FirebaseFirestore.FieldValue;
      } = {
        id: variantId,
        shop_id: normalizedShopId,
        product_id: productId,
        shopify_gid: v.id,
        inventory_item_gid: inventoryItemGid,
        sku: v.sku ?? null,
        title: v.title,
        image_url: v.image?.url ?? null,
        price_cents: priceCents,
        // Shopify GraphQL `price` on ProductVariant doesn't expose currency
        // directly; we don't read it here (would require shop.currencyCode).
        // currency stays nullable — UI falls back to the EUR locale.
        currency: null,
        updated_at: FieldValue.serverTimestamp(),
      };

      batch.set(
        db.collection(Collections.Variants).doc(variantId),
        variantDoc,
        // merge so we don't blow away on_hand_total etc. on re-sync
        { merge: true },
      );
      opsInBatch++;
      variantCount++;

      if (opsInBatch >= FIRESTORE_BATCH_MAX) {
        await flush(batch);
        batch = db.batch();
        opsInBatch = 0;
      }
    }
  }
  await flush(batch);

  log.info("shopify_sync_done", {
    productCount,
    variantCount,
    locationGid: location.id,
  });

  return { productCount, variantCount, locationGid: location.id };
  });
}
