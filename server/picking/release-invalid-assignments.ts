import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { loadLagerConfig } from "@/server/lager/config";
import {
  isBatchAssignableForShipping,
  isBatchExpired,
} from "./batch-assignability";
import { maybeStopOrderForUnassignableBatches } from "./stop-for-unshippable-batches";

/**
 * Drop open Charge assignments that are no longer shippable (expired MHD or
 * inside the configured cutoff). Commits in its own transaction so a failed
 * re-assign does not roll the release back.
 */
export async function releaseUnshippableBatchAssignments(
  orderId: string,
): Promise<number> {
  const db = adminDb();
  const lagerCfg = await loadLagerConfig();
  const minDays = lagerCfg.batch_min_days_before_expiry;
  const referenceDate = new Date();

  const released = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(
      db.collection(Collections.Orders).doc(orderId),
    );
    if (!orderSnap.exists) return 0;
    const order = orderSnap.data() as Order;
    if (
      order.internal_status !== "SHIP" &&
      order.internal_status !== "PICKING"
    ) {
      return 0;
    }

    const allocSnap = await tx.get(
      db.collection(Collections.Allocations).where("order_id", "==", orderId),
    );
    const open = allocSnap.docs
      .map((d) => ({ ref: d.ref, data: d.data() as Allocation }))
      .filter((a) => !a.data.consumed_at);
    if (open.length === 0) return 0;

    const batchIds = Array.from(new Set(open.map((a) => a.data.batch_id)));
    const batchSnaps = await Promise.all(
      batchIds.map((id) =>
        tx.get(db.collection(Collections.Batches).doc(id)),
      ),
    );
    const batchById = new Map(
      batchSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as Batch]),
    );

    const hasUnshippable = open.some((a) => {
      const b = batchById.get(a.data.batch_id);
      if (!b) return true;
      return !isBatchAssignableForShipping(
        b.expiry_date,
        minDays,
        referenceDate,
      );
    });
    if (!hasUnshippable) return 0;

    const releasedByBatch = new Map<string, number>();
    for (const a of open) {
      const batchRef = db.collection(Collections.Batches).doc(a.data.batch_id);
      const patch: Record<string, unknown> = {
        remaining_qty: FieldValue.increment(a.data.qty),
      };
      const b = batchById.get(a.data.batch_id);
      if (b) {
        const priorReleased = releasedByBatch.get(a.data.batch_id) ?? 0;
        const nextRemaining =
          (b.remaining_qty ?? 0) + priorReleased + a.data.qty;
        releasedByBatch.set(a.data.batch_id, priorReleased + a.data.qty);
        if (nextRemaining > 0) {
          patch.status = isBatchExpired(b.expiry_date, referenceDate)
            ? "EXPIRED"
            : "ACTIVE";
        }
      }
      tx.update(batchRef, patch);
      tx.delete(a.ref);
    }

    log.info("order_unshippable_assignments_released", {
      orderId,
      count: open.length,
      minDays,
    });
    return open.length;
  });

  await maybeStopOrderForUnassignableBatches(orderId);
  return released;
}
