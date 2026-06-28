import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type VariantLocationStock,
} from "@/server/firestore/schema";
import { isAppInventorySource } from "@/server/lager/config";
import { getShop } from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";
import { variantLocationStockForShop } from "@/server/tenant/queries";
import type { InventorySetEntry } from "@/server/shopify/mutations";
import { processOutbox } from "@/server/shopify/outbox";
import { getPrimaryLocationId } from "./stock";

/**
 * Build Shopify inventorySet rows for a variant — one row per location stock doc.
 * Falls back to primary location with net available when no per-location rows exist.
 */
export async function buildInventoryPushEntriesForVariant(
  variantId: string,
  shopId?: string,
): Promise<InventorySetEntry[]> {
  const db = adminDb();
  const vSnap = await db.collection(Collections.Variants).doc(variantId).get();
  if (!vSnap.exists) return [];

  const v = vSnap.data() ?? {};
  const inventoryItemGid = v.inventory_item_gid as string | undefined;
  if (!inventoryItemGid) return [];

  const resolvedShopId = shopId ?? (v.shop_id as string | undefined);
  if (!resolvedShopId) return [];

  const stockSnap = await db
    .collection(Collections.VariantLocationStock)
    .where("variant_id", "==", variantId)
    .get();

  if (stockSnap.empty) {
    const shop = await getShop(resolvedShopId);
    const locationGid = shop?.location_gid;
    if (!locationGid) return [];
    const onHand = (v.on_hand_total as number | undefined) ?? 0;
    const reserved = (v.reserved_total as number | undefined) ?? 0;
    return [
      {
        inventoryItemId: inventoryItemGid,
        locationId: locationGid,
        quantity: Math.max(0, onHand - reserved),
      },
    ];
  }

  const entries: InventorySetEntry[] = [];
  for (const doc of stockSnap.docs) {
    const row = doc.data() as VariantLocationStock;
    const locSnap = await db
      .collection(Collections.Locations)
      .doc(row.location_id)
      .get();
    if (!locSnap.exists || locSnap.data()?.active === false) continue;
    const locationGid = locSnap.data()?.shopify_gid as string | undefined;
    if (!locationGid) continue;
    entries.push({
      inventoryItemId: inventoryItemGid,
      locationId: locationGid,
      quantity: Math.max(0, row.on_hand ?? 0),
    });
  }
  return entries;
}

const CHUNK_SIZE = 50;

export type BulkLocationPushResult = {
  queuedChunks: number;
  variantCount: number;
  locationRows: number;
  skipped: number;
  drained: { processed: number; failed: number; done: number };
};

/** Push all variant×location stock rows for a shop to Shopify. */
export async function pushAllLocationStockToShopify(
  shopId: string,
): Promise<BulkLocationPushResult> {
  if (!(await isAppInventorySource(shopId))) {
    throw new Error(
      "Bestandsführung liegt bei Shopify — Push ist deaktiviert.",
    );
  }

  const db = adminDb();
  const normalizedShopId = normalizeShopId(shopId);
  const stockSnap = await variantLocationStockForShop(db, normalizedShopId).get();

  const entries: InventorySetEntry[] = [];
  const variantIds = new Set<string>();
  let skipped = 0;

  if (stockSnap.empty) {
    const primaryId = await getPrimaryLocationId(normalizedShopId);
    if (!primaryId) {
      return {
        queuedChunks: 0,
        variantCount: 0,
        locationRows: 0,
        skipped: 0,
        drained: { processed: 0, failed: 0, done: 0 },
      };
    }
    const { pushAllInventoryToShopify } = await import(
      "@/server/inventory/push-all"
    );
    const legacy = await pushAllInventoryToShopify(normalizedShopId);
    return {
      queuedChunks: legacy.queuedChunks,
      variantCount: legacy.variantCount,
      locationRows: legacy.variantCount,
      skipped: legacy.skipped,
      drained: legacy.drained,
    };
  }

  for (const doc of stockSnap.docs) {
    const row = doc.data() as VariantLocationStock;
    const [vSnap, locSnap] = await Promise.all([
      db.collection(Collections.Variants).doc(row.variant_id).get(),
      db.collection(Collections.Locations).doc(row.location_id).get(),
    ]);
    if (!vSnap.exists || !locSnap.exists || locSnap.data()?.active === false) {
      skipped++;
      continue;
    }
    const inventoryItemGid = vSnap.data()?.inventory_item_gid as
      | string
      | undefined;
    const locationGid = locSnap.data()?.shopify_gid as string | undefined;
    if (!inventoryItemGid || !locationGid) {
      skipped++;
      continue;
    }

    variantIds.add(row.variant_id);
    entries.push({
      inventoryItemId: inventoryItemGid,
      locationId: locationGid,
      quantity: Math.max(0, row.on_hand ?? 0),
    });
  }

  if (entries.length === 0) {
    return {
      queuedChunks: 0,
      variantCount: 0,
      locationRows: 0,
      skipped,
      drained: { processed: 0, failed: 0, done: 0 },
    };
  }

  const chunks: InventorySetEntry[][] = [];
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + CHUNK_SIZE));
  }

  const now = FieldValue.serverTimestamp();
  const runId = `bulk-loc-${Date.now()}`;
  let writeBatch = db.batch();
  let ops = 0;

  for (let idx = 0; idx < chunks.length; idx++) {
    const ref = db.collection(Collections.ShopifyOutbox).doc();
    writeBatch.set(ref, {
      id: ref.id,
      op: "INVENTORY_SET",
      payload: {
        reason: "correction",
        referenceDocumentUri: `shrymp-logistics://bulk-push/${runId}/${idx}`,
        setQuantities: chunks[idx],
      },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    ops++;
    if (ops >= 450) {
      await writeBatch.commit();
      writeBatch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await writeBatch.commit();

  const drained = await processOutbox(Math.min(chunks.length, 200));

  return {
    queuedChunks: chunks.length,
    variantCount: variantIds.size,
    locationRows: entries.length,
    skipped,
    drained,
  };
}
