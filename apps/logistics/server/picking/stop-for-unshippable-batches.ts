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
  enqueueLagerTagSet,
  processOutboxByIds,
} from "@/server/shopify/outbox";
import { isBatchAssignableForShipping } from "./batch-assignability";
import {
  loadBatchAssignFeasibility,
  type BatchAssignBlockReason,
} from "./batch-assign-feasibility";
import { orderAssignmentCoversLineItems } from "./assignment-coverage";

/**
 * Flip SHIP/PICKING → STOP when no versandfähige Charge can be pinned, and push
 * LAGER_STOP to Shopify. Called after stale assignments are released.
 */
export async function maybeStopOrderForUnassignableBatches(
  orderId: string,
): Promise<boolean> {
  const lagerCfg = await loadLagerConfig();
  if (!lagerCfg.batches_enabled) return false;

  const db = adminDb();
  const minDays = lagerCfg.batch_min_days_before_expiry;
  const referenceDate = new Date();

  const orderSnap = await db.collection(Collections.Orders).doc(orderId).get();
  if (!orderSnap.exists) return false;
  const order = orderSnap.data() as Order;
  if (
    order.internal_status !== "SHIP" &&
    order.internal_status !== "PICKING"
  ) {
    return false;
  }

  const allocSnap = await db
    .collection(Collections.Allocations)
    .where("order_id", "==", orderId)
    .get();
  const openAllocs = allocSnap.docs
    .map((d) => d.data() as Allocation)
    .filter((a) => !a.consumed_at);

  if (
    openAllocs.length > 0 &&
    orderAssignmentCoversLineItems(order.line_items, openAllocs)
  ) {
    const batchIds = Array.from(new Set(openAllocs.map((a) => a.batch_id)));
    const batchSnaps = await Promise.all(
      batchIds.map((id) => db.collection(Collections.Batches).doc(id).get()),
    );
    const allShippable = batchSnaps.every((snap) => {
      if (!snap.exists) return false;
      const b = snap.data() as Batch;
      return isBatchAssignableForShipping(
        b.expiry_date,
        minDays,
        referenceDate,
      );
    });
    if (allShippable) return false;
  }

  const feasibility = await loadBatchAssignFeasibility(
    order,
    minDays,
    referenceDate,
  );
  if (feasibility.assignable) return false;

  return stopOrderForBatchBlock(orderId, feasibility.reason);
}

async function stopOrderForBatchBlock(
  orderId: string,
  reason: BatchAssignBlockReason,
): Promise<boolean> {
  const db = adminDb();

  const tagSyncNeeded = await db.runTransaction(async (tx) => {
    const orderRef = db.collection(Collections.Orders).doc(orderId);
    const snap = await tx.get(orderRef);
    if (!snap.exists) return null;
    const order = snap.data() as Order;
    if (
      order.internal_status !== "SHIP" &&
      order.internal_status !== "PICKING"
    ) {
      return null;
    }

    tx.update(orderRef, {
      internal_status: "STOP",
      stop_reason: reason,
      updated_at: FieldValue.serverTimestamp(),
    });

    for (const li of order.line_items) {
      const variantRef = db.collection(Collections.Variants).doc(li.variant_id);
      tx.update(variantRef, {
        reserved_total: FieldValue.increment(-li.qty),
        available: FieldValue.increment(li.qty),
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    return order.lager_tag_synced !== "STOP";
  });

  if (tagSyncNeeded === null) return false;

  if (tagSyncNeeded) {
    const outboxId = await enqueueLagerTagSet(orderId, "STOP", order.shop_id);
    try {
      await processOutboxByIds([outboxId]);
    } catch (e) {
      log.warn("stop_order_lager_tag_drain_failed", {
        orderId,
        error: String(e),
      });
    }
  }

  log.info("order_stopped_unshippable_batches", { orderId, reason });
  return true;
}
