import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Allocation } from "@/server/firestore/schema";
import { log } from "@/lib/logger";

/**
 * Release an order's stock hold when it's cancelled:
 *   - Free the variant-level reservation (`reserved_total -= order qty`) if the
 *     order was SHIP or PICKING. Reservations now live on the order's status,
 *     not on allocation rows — a SHIP order that was never printed has no
 *     allocations but still holds a reservation.
 *   - Give back any printed Charge assignment (`batch.remaining_qty += qty`) and
 *     mark those allocations released (audit-preserving `consumed_at` marker).
 *   - `on_hand_total` is untouched — the goods never left the warehouse.
 *
 * The caller passes the order's PRE-cancel snapshot (`prevOrder`) because the
 * cancel webhook flips `internal_status` to CANCELLED before calling this, so we
 * can no longer read the reserving status off the doc.
 *
 * Idempotent: re-running frees nothing (no open allocations, and the caller
 * won't pass a reserved prevStatus twice in practice).
 */
export type ReleaseResult = {
  releasedAllocations: number;
  freedByVariant: Record<string, number>;
};

export type ReleasePrevOrder = {
  internal_status?: string;
  line_items?: { variant_id: string; qty: number }[];
};

export async function releaseOrderAllocations(
  orderId: string,
  userId: string | null,
  reason: string = "order_cancelled",
  prevOrder?: ReleasePrevOrder | null,
): Promise<ReleaseResult> {
  const db = adminDb();
  const releasedAt = FieldValue.serverTimestamp();

  // Open (printed) Charge assignments, if any.
  const allocSnap = await db
    .collection(Collections.Allocations)
    .where("order_id", "==", orderId)
    .get();
  const open = allocSnap.docs
    .map((d) => ({ ref: d.ref, data: d.data() as Allocation }))
    .filter((a) => !a.data.consumed_at);

  // Batch stock to give back (only printed orders hold batch stock).
  const restoreByBatch = new Map<string, number>();
  for (const { data } of open) {
    restoreByBatch.set(
      data.batch_id,
      (restoreByBatch.get(data.batch_id) ?? 0) + data.qty,
    );
  }

  // Reservation to free, per variant. Authoritative source = the pre-cancel
  // order line items IF it was in a reserving state. Fall back to the open
  // allocations when no prev snapshot was supplied (legacy callers).
  const freedByVariant: Record<string, number> = {};
  const wasReserved =
    prevOrder?.internal_status === "SHIP" ||
    prevOrder?.internal_status === "PICKING";
  if (wasReserved && prevOrder?.line_items) {
    for (const li of prevOrder.line_items) {
      freedByVariant[li.variant_id] =
        (freedByVariant[li.variant_id] ?? 0) + li.qty;
    }
  } else if (!prevOrder) {
    for (const { data } of open) {
      freedByVariant[data.variant_id] =
        (freedByVariant[data.variant_id] ?? 0) + data.qty;
    }
  }

  if (open.length === 0 && Object.keys(freedByVariant).length === 0) {
    log.info("release_allocations_noop", { orderId });
    return { releasedAllocations: 0, freedByVariant: {} };
  }

  const variantIds = Object.keys(freedByVariant);

  await db.runTransaction(async (tx) => {
    // Reads first (Firestore txn rule).
    const variantRefs = variantIds.map((id) =>
      db.collection(Collections.Variants).doc(id),
    );
    const variantSnaps = await Promise.all(variantRefs.map((r) => tx.get(r)));

    // Writes — mark allocations released (keep audit trail).
    for (const { ref } of open) {
      tx.update(ref, {
        consumed_at: releasedAt,
        released: true,
        release_reason: reason,
      });
    }

    // Give batch stock back (atomic increment — no read needed).
    for (const [batchId, qty] of restoreByBatch) {
      if (qty === 0) continue;
      tx.update(db.collection(Collections.Batches).doc(batchId), {
        remaining_qty: FieldValue.increment(qty),
        status: "ACTIVE",
      });
    }

    // Free the variant reservation.
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
    for (const [vid, qty] of Object.entries(freedByVariant)) {
      const movRef = db.collection(Collections.InventoryMovements).doc();
      batch.set(movRef, {
        id: movRef.id,
        type: "RELEASE",
        batch_id: null,
        variant_id: vid,
        qty, // positive — stock returns to available pool
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
