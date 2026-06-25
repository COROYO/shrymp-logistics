import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Order,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { assignBatchesForOrder } from "./assign-batches";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import { orderHasActiveConsumption } from "./consume-guard";

/**
 * Treat a Shopify-side fulfillment (someone clicked "Fulfill" inside Shopify
 * Admin, or another integration created the fulfillment) as if WE had packed
 * the order. We:
 *
 *   1. Refresh FEFO so the oldest-MHD batches get consumed.
 *   2. In one transaction: drain open allocations, decrement batches +
 *      variant counters, mark the order PACKED.
 *   3. Push the tag swap LAGER_SHIP → LAGER_PACKED and the new inventory
 *      level back to Shopify. We do NOT enqueue FULFILLMENT_CREATE — Shopify
 *      already did that, and a re-create would 422.
 *
 * Idempotent: if `internal_status` is already PACKED or CANCELLED, returns
 * `{ ok: true, applied: false }`.
 *
 * Returns `applied: false` (with a reason) when we can't consume stock —
 * e.g. order is in NEW/STOP with no allocations possible. In that case we
 * still flip the order to PACKED so it disappears from the picking queue,
 * but stock is left untouched and an admin needs to reconcile.
 */
export type ExternalFulfillmentResult = {
  ok: true;
  applied: boolean;
  reason?: string;
};

const TAG_SHIP = "LAGER_SHIP";
const TAG_STOP = "LAGER_STOP";
const TAG_PACKED = "LAGER_PACKED";

export async function applyExternalFulfillment(
  orderId: string,
): Promise<ExternalFulfillmentResult> {
  const db = adminDb();
  const orderRef = db.collection(Collections.Orders).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    return { ok: true, applied: false, reason: "order_not_found" };
  }
  const order = orderSnap.data() as Order;

  if (order.internal_status === "PACKED") {
    return { ok: true, applied: false, reason: "already_packed" };
  }
  if (order.internal_status === "CANCELLED") {
    return { ok: true, applied: false, reason: "cancelled" };
  }
  // Idempotency backstop: if this order was already fulfilled once (its stock is
  // consumed), NEVER consume again — even if its status was somehow reverted to
  // SHIP (e.g. an order still sitting in the pre-fix clobber backlog). This
  // defends against double-deduction independently of the status-revert guards.
  if (order.externally_fulfilled) {
    return { ok: true, applied: false, reason: "already_externally_fulfilled" };
  }

  const existingAllocs = await db
    .collection(Collections.Allocations)
    .where("order_id", "==", orderId)
    .get();
  if (orderHasActiveConsumption(existingAllocs.docs.map((d) => d.data() as Allocation))) {
    log.warn("external_fulfill_already_consumed", { orderId });
    return { ok: true, applied: false, reason: "already_consumed" };
  }

  // Pin the oldest-MHD Chargen (decrements batch.remaining_qty) so we consume
  // the right batches. Best-effort — even if it bails, we still mark PACKED.
  try {
    await assignBatchesForOrder(orderId);
  } catch (e) {
    log.warn("external_fulfill_assign_failed", {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const consumedByVariant = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(orderRef);
    if (!fresh.exists) throw new Error("order_gone_mid_txn");
    const o = fresh.data() as Order;
    if (
      o.internal_status === "PACKED" ||
      o.internal_status === "CANCELLED" ||
      o.externally_fulfilled
    ) {
      return null;
    }

    const allocSnap = await tx.get(
      db.collection(Collections.Allocations).where("order_id", "==", orderId),
    );
    const allAllocs = allocSnap.docs.map((d) => d.data() as Allocation);
    if (orderHasActiveConsumption(allAllocs)) {
      return null;
    }
    const open = allocSnap.docs
      .map((d) => ({ ref: d.ref, data: d.data() as Allocation }))
      .filter((a) => !a.data.consumed_at);

    const consumedByVariant: Record<string, number> = {};

    if (open.length === 0) {
      // No reservations — order is being fulfilled on Shopify but we don't
      // have stock pinned to it (typical for orders that were STOPped or
      // never seen). Flip to PACKED so the UI is in sync; the stock figures
      // need manual reconciliation.
      tx.update(orderRef, {
        internal_status: "PACKED",
        packed_at: FieldValue.serverTimestamp(),
        packed_by_uid: "shopify",
        externally_fulfilled: true,
        updated_at: FieldValue.serverTimestamp(),
      });
      return consumedByVariant;
    }

    // Reads first: variants the open allocations touch. (batch.remaining_qty
    // was already decremented at assignment, so packing doesn't touch it.)
    const variantIds = Array.from(new Set(open.map((a) => a.data.variant_id)));
    const variantRefs = variantIds.map((id) =>
      db.collection(Collections.Variants).doc(id),
    );
    const variantSnaps = await Promise.all(variantRefs.map((r) => tx.get(r)));

    for (const a of open) {
      consumedByVariant[a.data.variant_id] =
        (consumedByVariant[a.data.variant_id] ?? 0) + a.data.qty;
    }

    // Allocations: mark consumed.
    for (const a of open) {
      tx.update(a.ref, { consumed_at: FieldValue.serverTimestamp() });
    }

    // Variants: decrement counters.
    for (let i = 0; i < variantIds.length; i++) {
      const id = variantIds[i] as string;
      const snap = variantSnaps[i];
      const ref = variantRefs[i];
      if (!snap?.exists || !ref) continue;
      const d = snap.data() ?? {};
      const onHand = (d.on_hand_total as number) ?? 0;
      const reserved = (d.reserved_total as number) ?? 0;
      const qty = consumedByVariant[id] ?? 0;
      const nextOnHand = onHand - qty;
      const nextReserved = Math.max(0, reserved - qty);
      tx.update(ref, {
        on_hand_total: nextOnHand,
        reserved_total: nextReserved,
        available: nextOnHand - nextReserved,
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    tx.update(orderRef, {
      internal_status: "PACKED",
      packed_at: FieldValue.serverTimestamp(),
      packed_by_uid: "shopify",
      externally_fulfilled: true,
      updated_at: FieldValue.serverTimestamp(),
    });

    return consumedByVariant;
  });

  if (consumedByVariant === null) {
    // Lost the race to a concurrent path that already packed/cancelled it,
    // or stock was already committed for this order (consume guard).
    return { ok: true, applied: false, reason: "race_lost_or_already_consumed" };
  }

  // ---- Outside-tx: Shopify outbox + audit ----
  await queueShopifyOutboxForExternal(orderId, consumedByVariant);

  // Drain outbox synchronously so Shopify reflects tags + stock by the time
  // we return (serverless containers can die after the response).
  try {
    const { processOutbox } = await import("@/server/shopify/outbox");
    await processOutbox(20);
  } catch (e) {
    log.warn("external_fulfill_outbox_drain_failed", {
      orderId,
      error: String(e),
    });
  }

  // Re-run allocation: the consumed stock might have been blocking other
  // STOP orders, and the now-free reservations create new headroom.
  await enqueueAllocationRun({
    triggeredBy: "PACKING_DONE",
    triggerEventId: orderId,
  });

  log.info("external_fulfillment_applied", {
    orderId,
    consumedByVariant,
  });
  return { ok: true, applied: true };
}

async function queueShopifyOutboxForExternal(
  orderId: string,
  consumedQtyByVariant: Record<string, number>,
): Promise<void> {
  const db = adminDb();
  let batch = db.batch();
  let ops = 0;
  const now = FieldValue.serverTimestamp();

  // Tag swap: PACKED in, SHIP and STOP out. We strip STOP too because an
  // externally-fulfilled order may have been in STOP state on our side.
  for (const [op, tags] of [
    ["TAGS_ADD", [TAG_PACKED]],
    ["TAGS_REMOVE", [TAG_SHIP]],
    ["TAGS_REMOVE", [TAG_STOP]],
  ] as const) {
    const ref = db.collection(Collections.ShopifyOutbox).doc();
    batch.set(ref, {
      id: ref.id,
      op,
      payload: { orderId, tags },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    ops++;
  }

  // Inventory push: one entry per (variant → new on_hand). Skips if we
  // didn't actually consume anything (the no-allocations path).
  const metaSnap = await db
    .collection(Collections.Config)
    .doc("shopify_meta")
    .get();
  const locationGid = metaSnap.data()?.location_gid as string | undefined;

  for (const variantId of Object.keys(consumedQtyByVariant)) {
    if (!locationGid) break;
    const vSnap = await db
      .collection(Collections.Variants)
      .doc(variantId)
      .get();
    if (!vSnap.exists) continue;
    const v = vSnap.data() ?? {};
    const inventoryItemGid = v.inventory_item_gid as string | undefined;
    if (!inventoryItemGid) continue;
    const onHand = (v.on_hand_total as number) ?? 0;

    const ref = db.collection(Collections.ShopifyOutbox).doc();
    batch.set(ref, {
      id: ref.id,
      op: "INVENTORY_SET",
      payload: {
        reason: "correction",
        referenceDocumentUri: `shrymp-logistics://order/${orderId}/external-fulfill`,
        setQuantities: [
          {
            inventoryItemId: inventoryItemGid,
            locationId: locationGid,
            quantity: onHand,
          },
        ],
      },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}
