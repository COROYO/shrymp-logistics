import "server-only";
import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import {
  iterateAllProducts,
  fetchInventoryLevelsByItemGids,
} from "./queries";
import { mapShopifyProductCatalogFields } from "./catalog-mapper";

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

/** Coerce Shopify Money scalar or `{ amount }` object to a decimal string. */
export function shopifyMoneyField(
  v: string | null | undefined | { amount?: string | null },
): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const amount = v.amount?.trim();
  return amount ? amount : null;
}

export function shopifyMoneyToCents(
  v: string | null | undefined | { amount?: string | null },
): number | null {
  return parsePriceToCents(shopifyMoneyField(v));
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
      const mapped = mapShopifyProductCatalogFields(p, normalizedShopId);

      batch.set(
        db.collection(Collections.Products).doc(mapped.productDoc.id),
        mapped.productDoc,
        { merge: true },
      );
      opsInBatch++;
      productCount++;

      for (const v of mapped.variants) {
        if (!v.inventoryItemGid) {
          log.warn("variant_without_inventory_item", {
            variantGid: v.doc.shopify_gid,
          });
          continue;
        }

        batch.set(
          db.collection(Collections.Variants).doc(v.variantId),
          v.doc,
          { merge: true },
        );
        opsInBatch++;
        variantCount++;

        inventoryItemToVariant.set(v.inventoryItemGid, v.variantId);

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
