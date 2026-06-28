import "server-only";
import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import {
  iterateAllProducts,
  fetchInventoryLevelsByItemGids,
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

const FIRESTORE_BATCH_MAX = 450;

export type SyncProductsOptions = {
  /** When true, pull Shopify available qty per location into our DB. */
  syncInventory?: boolean;
  /** When set, progress is written to product_sync_runs/{runId}. */
  runId?: string;
  onProgress?: (patch: import("./product-sync-run").ProductSyncRunProgress) => Promise<void>;
};

export type SyncProductsResult = {
  productCount: number;
  variantCount: number;
  locationGid: string;
  locationCount: number;
  inventoryUpdated?: number;
  inventoryUnchanged?: number;
};

export async function syncProductsAndVariants(
  shopId: string,
  options: SyncProductsOptions = {},
): Promise<SyncProductsResult> {
  const { runWithTenantAsync } = await import("@/server/tenant/context");
  const { updateShopMeta } = await import("@/server/tenant/shop");
  const { normalizeShopId } = await import("@/server/tenant/id");
  const normalizedShopId = normalizeShopId(shopId);

  return runWithTenantAsync(normalizedShopId, async () => {
    const db = adminDb();
    const report = async (
      patch: import("./product-sync-run").ProductSyncRunProgress,
    ) => {
      if (options.onProgress) {
        await options.onProgress(patch);
      } else if (options.runId) {
        const { updateProductSyncRunProgress } = await import(
          "./product-sync-run"
        );
        await updateProductSyncRunProgress(options.runId, patch);
      }
    };

    await report({ phase: "locations" });
    const { syncLocationsFromShopify } = await import(
      "@/server/locations/sync-from-shopify"
    );
    const locSync = await syncLocationsFromShopify(normalizedShopId);

    await updateShopMeta(normalizedShopId, {
      location_gid: locSync.primaryLocationGid,
      api_version: process.env.SHOPIFY_API_VERSION ?? "2026-04",
    });

    let productCount = 0;
    let variantCount = 0;
    let batch = db.batch();
    let opsInBatch = 0;
    const inventoryPulls: {
      variantId: string;
      locationId: string;
      shopifyAvailable: number;
    }[] = [];
    const inventoryItemToVariant = new Map<string, string>();
    const syncInventory = options.syncInventory === true;

    const flush = async (b: WriteBatch) => {
      if (opsInBatch > 0) {
        await b.commit();
      }
    };

    await report({ phase: "catalog", product_count: 0, variant_count: 0 });

    for await (const p of iterateAllProducts(50)) {
      const productId = numericIdFromGid(p.id);
      const productImage = p.featuredMedia?.preview?.image?.url ?? null;

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
          barcode: v.barcode ?? null,
          title: v.title,
          image_url: v.image?.url ?? null,
          price_cents: parsePriceToCents(v.price),
          currency: null,
          updated_at: FieldValue.serverTimestamp(),
        };

        batch.set(
          db.collection(Collections.Variants).doc(variantId),
          variantDoc,
          { merge: true },
        );
        opsInBatch++;
        variantCount++;

        inventoryItemToVariant.set(inventoryItemGid, variantId);

        if (opsInBatch >= FIRESTORE_BATCH_MAX) {
          await flush(batch);
          batch = db.batch();
          opsInBatch = 0;
        }
      }

      await report({ phase: "catalog", product_count: productCount, variant_count: variantCount });
    }
    await flush(batch);

    if (syncInventory && inventoryItemToVariant.size > 0) {
      await report({ phase: "inventory", product_count: productCount, variant_count: variantCount });
      for await (const row of fetchInventoryLevelsByItemGids([
        ...inventoryItemToVariant.keys(),
      ])) {
        const variantId = inventoryItemToVariant.get(row.inventoryItemGid);
        if (!variantId) continue;
        for (const loc of row.locations) {
          inventoryPulls.push({
            variantId,
            locationId: numericIdFromGid(loc.locationGid),
            shopifyAvailable: loc.available,
          });
        }
      }
    }

    let inventoryUpdated: number | undefined;
    let inventoryUnchanged: number | undefined;
    if (syncInventory && inventoryPulls.length > 0) {
      await report({
        phase: "applying_inventory",
        product_count: productCount,
        variant_count: variantCount,
      });
      const { applyShopifyInventoryByLocationBulk } = await import(
        "@/server/locations/inventory-pull"
      );
      const refId = `product-sync-${Date.now()}`;
      const inv = await applyShopifyInventoryByLocationBulk(
        normalizedShopId,
        inventoryPulls,
        refId,
      );
      inventoryUpdated = inv.variantsUpdated;
      inventoryUnchanged = inv.unchanged;
    }

    log.info("shopify_sync_done", {
      productCount,
      variantCount,
      locationGid: locSync.primaryLocationGid,
      locationCount: locSync.count,
      syncInventory,
      inventoryUpdated,
    });

    return {
      productCount,
      variantCount,
      locationGid: locSync.primaryLocationGid,
      locationCount: locSync.count,
      inventoryUpdated,
      inventoryUnchanged,
    };
  });
}
