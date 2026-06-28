import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { normalizeShopId } from "@/server/tenant/id";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import {
  recomputeVariantTotalsFromLocations,
  type LocationStockPull,
  variantLocationStockDocId,
} from "./stock";

export type BulkApplyLocationInventoryResult = {
  locationRowsUpdated: number;
  variantsUpdated: number;
  unchanged: number;
};

const FIRESTORE_BATCH_MAX = 450;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Upsert per-location stock from Shopify available qty, then recompute each
 * affected variant's rolled-up totals.
 */
export async function applyShopifyInventoryByLocationBulk(
  shopId: string,
  pulls: LocationStockPull[],
  refId: string,
): Promise<BulkApplyLocationInventoryResult> {
  if (pulls.length === 0) {
    return { locationRowsUpdated: 0, variantsUpdated: 0, unchanged: 0 };
  }

  const db = adminDb();
  const normalizedShopId = normalizeShopId(shopId);
  let locationRowsUpdated = 0;
  let unchanged = 0;

  for (const chunk of chunkArray(pulls, 80)) {
    let batch = db.batch();
    let ops = 0;
    const now = FieldValue.serverTimestamp();

    for (const pull of chunk) {
      const onHand = Math.max(0, pull.shopifyAvailable);
      const ref = db
        .collection(Collections.VariantLocationStock)
        .doc(variantLocationStockDocId(pull.variantId, pull.locationId));
      batch.set(
        ref,
        {
          id: ref.id,
          shop_id: normalizedShopId,
          variant_id: pull.variantId,
          location_id: pull.locationId,
          on_hand: onHand,
          updated_at: now,
        },
        { merge: true },
      );
      ops++;
      locationRowsUpdated++;

      if (ops >= FIRESTORE_BATCH_MAX) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
  }

  const variantIds = [...new Set(pulls.map((p) => p.variantId))];
  let variantsUpdated = 0;

  for (const variantId of variantIds) {
    const before = await db.collection(Collections.Variants).doc(variantId).get();
    if (!before.exists) continue;
    const prevOnHand = (before.data()?.on_hand_total as number | undefined) ?? 0;
    const prevAvail = (before.data()?.available as number | undefined) ?? 0;

    const totals = await recomputeVariantTotalsFromLocations(variantId);
    if (!totals) continue;

    if (totals.onHand !== prevOnHand || totals.available !== prevAvail) {
      variantsUpdated++;
      const delta = totals.onHand - prevOnHand;
      if (delta !== 0) {
        const movementRef = db.collection(Collections.InventoryMovements).doc();
        await movementRef.set({
          id: movementRef.id,
          shop_id: normalizedShopId,
          type: "ADJUSTMENT",
          batch_id: null,
          variant_id: variantId,
          qty: delta,
          ref: { kind: "EXTERNAL", id: refId },
          user_id: null,
          note: `Shopify inventory sync (on_hand=${totals.onHand})`,
          created_at: FieldValue.serverTimestamp(),
        });
      }
    } else {
      unchanged++;
    }
  }

  if (variantsUpdated > 0) {
    log.info("shopify_location_inventory_bulk_applied", {
      shopId: normalizedShopId,
      locationRowsUpdated,
      variantsUpdated,
      refId,
    });
    await enqueueAllocationRun({
      shopId,
      triggeredBy: "MANUAL",
      triggerEventId: refId,
    });
  }

  return { locationRowsUpdated, variantsUpdated, unchanged };
}
