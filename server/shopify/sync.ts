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
export async function syncProductsAndVariants(): Promise<{
  productCount: number;
  variantCount: number;
  locationGid: string;
}> {
  const db = adminDb();
  const location = await resolvePrimaryFulfillmentLocation();

  await db
    .collection(Collections.Config)
    .doc(ConfigDocs.ShopifyMeta)
    .set(
      {
        shop_domain: process.env.SHOPIFY_SHOP_DOMAIN ?? null,
        location_gid: location.id,
        api_version: process.env.SHOPIFY_API_VERSION ?? "2026-04",
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

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

    const productDoc: Omit<Product, "synced_at" | "updated_at_shopify"> & {
      synced_at: FirebaseFirestore.FieldValue;
      updated_at_shopify: Date;
    } = {
      id: productId,
      shopify_gid: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
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

      const variantDoc: Omit<
        Variant,
        "updated_at" | "on_hand_total" | "reserved_total" | "available"
      > & {
        updated_at: FirebaseFirestore.FieldValue;
      } = {
        id: variantId,
        product_id: productId,
        shopify_gid: v.id,
        inventory_item_gid: inventoryItemGid,
        sku: v.sku ?? null,
        title: v.title,
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
}
