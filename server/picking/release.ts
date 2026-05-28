import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";

/**
 * Release every open (not-yet-consumed) allocation for an order:
 *   - Mark the allocation `consumed_at` with a special `released_at` marker
 *     so it drops out of "open" queries but the audit trail is preserved
 *   - Decrement `variant.reserved_total` so the freed stock counts as
 *     available again
 *   - Write a RELEASE inventory_movement per allocation for audit
 *
 * Used when an order is cancelled in Shopify. Idempotent: re-running on the
 * same order is a no-op (no allocations marked open anymore).
 *
 * Returns the number of allocations released and the total quantity freed
 * per variant.
 */
export type ReleaseResult = {
  releasedAllocations: number;
  freedByVariant: Record<string, number>;
};

export async function releaseOrderAllocations(
  orderId: string,
  userId: string | null,
  reason: string = "order_cancelled",
): Promise<ReleaseResult> {
  const db = adminDb();
  const releasedAt = FieldValue.serverTimestamp();

  // Read open allocations outside the txn (Firestore txn read limits).
  const allocSnap = await db
    .collection(Collections.Allocations)
    .where("order_id", "==", orderId)
    .get();
  const open = allocSnap.docs
    .map((d) => ({ ref: d.ref, data: d.data() as Allocation }))
    .filter((a) => !a.data.consumed_at);

  if (open.length === 0) {
    log.info("release_allocations_noop", { orderId });
    return { releasedAllocations: 0, freedByVariant: {} };
  }

  const freedByVariant: Record<string, number> = {};
  for (const { data } of open) {
    freedByVariant[data.variant_id] =
      (freedByVariant[data.variant_id] ?? 0) + data.qty;
  }

  const variantIds = Object.keys(freedByVariant);

  await db.runTransaction(async (tx) => {
    // Reads first (Firestore txn rule).
    const variantRefs = variantIds.map((id) =>
      db.collection(Collections.Variants).doc(id),
    );
    const variantSnaps = await Promise.all(variantRefs.map((r) => tx.get(r)));

    // Writes.
    for (const { ref } of open) {
      // We re-use `consumed_at` as the marker so the existing "open" filter
      // (consumed_at == null) already excludes released ones. The `released`
      // flag distinguishes a real CONSUME from a RELEASE in the audit log.
      tx.update(ref, {
        consumed_at: releasedAt,
        released: true,
        release_reason: reason,
      });
    }

    for (let i = 0; i < variantIds.length; i++) {
      const vid = variantIds[i]!;
      const vSnap = variantSnaps[i];
      const vRef = variantRefs[i]!;
      const freed = freedByVariant[vid] ?? 0;
      if (freed === 0) continue;
      const reservedBefore = (vSnap?.data()?.reserved_total as number) ?? 0;
      const onHand = (vSnap?.data()?.on_hand_total as number) ?? 0;
      const nextReserved = Math.max(0, reservedBefore - freed);
      tx.update(vRef, {
        reserved_total: nextReserved,
        available: onHand - nextReserved,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
  });

  // Audit log (outside the txn; failure here doesn't roll back the release).
  try {
    const batch = db.batch();
    for (const { data } of open) {
      const movRef = db.collection(Collections.InventoryMovements).doc();
      batch.set(movRef, {
        id: movRef.id,
        type: "RELEASE",
        batch_id: data.batch_id,
        variant_id: data.variant_id,
        qty: data.qty, // positive — stock returns to available pool
        ref: { kind: "ORDER", id: orderId },
        user_id: userId,
        note: reason,
        created_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (e) {
    log.warn("release_audit_log_failed", {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  log.info("allocations_released", {
    orderId,
    count: open.length,
    freedByVariant,
    reason,
  });
  return {
    releasedAllocations: open.length,
    freedByVariant,
  };
}
