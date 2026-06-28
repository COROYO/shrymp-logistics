import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Order,
  type OrderInternalStatus,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { loadLagerConfig } from "@/server/lager/config";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import { assignBatchesForOrder } from "./assign-batches";
import { orderHasActiveConsumption } from "./consume-guard";

/**
 * Atomic state transitions for the picking/packing workflow.
 *
 * All three functions guarantee that the order's `internal_status` can only
 * move along the documented state machine (PROJECT.md §4.1). They use
 * Firestore transactions so concurrent clicks from multiple staff don't
 * leave the system in a half-state.
 */

export class TransitionError extends Error {
  constructor(
    public readonly code:
      | "order_not_found"
      | "not_in_ship_state"
      | "not_in_picking_state"
      | "no_open_allocations"
      | "already_consumed"
      | "batch_inconsistency",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TransitionError";
  }
}

const TAG_SHIP = "LAGER_SHIP";
const TAG_PACKED = "LAGER_PACKED";

// ----------------------- startPicking -----------------------

export async function startPicking(
  orderId: string,
  userId: string,
): Promise<void> {
  const db = adminDb();
  const ref = db.collection(Collections.Orders).doc(orderId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TransitionError("order_not_found");
    const status = snap.data()?.internal_status as OrderInternalStatus;
    if (status !== "SHIP") {
      throw new TransitionError(
        "not_in_ship_state",
        `Order ist in Status "${status}", erwartet "SHIP".`,
      );
    }
    tx.update(ref, {
      internal_status: "PICKING",
      picking_started_at: FieldValue.serverTimestamp(),
      picking_started_by_uid: userId,
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  log.info("picking_started", { orderId, userId });
}

// ----------------------- cancelPicking -----------------------

export async function cancelPicking(
  orderId: string,
  userId: string,
): Promise<void> {
  const db = adminDb();
  const ref = db.collection(Collections.Orders).doc(orderId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TransitionError("order_not_found");
    const status = snap.data()?.internal_status as OrderInternalStatus;
    if (status !== "PICKING") {
      throw new TransitionError(
        "not_in_picking_state",
        `Order ist in Status "${status}", erwartet "PICKING".`,
      );
    }
    tx.update(ref, {
      internal_status: "SHIP",
      picking_started_at: FieldValue.delete(),
      picking_started_by_uid: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  log.info("picking_cancelled", { orderId, userId });
}

// ----------------------- confirmPacking -----------------------

export type TrackingInput = {
  carrier?: string;
  number?: string;
  url?: string;
};

export type ConfirmPackingResult = {
  consumedQtyByBatch: Record<string, number>;
  consumedQtyByVariant: Record<string, number>;
};

/**
 * Final commit of a packed order.
 *
 * Charge assignment happens at slip print, but we ensure it here too (idempotent)
 * so packing can't proceed without pinned batches — e.g. if the operator packs
 * without printing. `batch.remaining_qty` was already decremented at assignment,
 * so packing does NOT touch it; it only realizes the physical outflow.
 *
 * In ONE Firestore transaction:
 *   1. Verify order is in PICKING state
 *   2. Read all open allocations for the order
 *   3. Mark allocations.consumed_at
 *   4. Decrement variant.on_hand_total and reserved_total, recompute available
 *   5. Set order.internal_status = PACKED
 *
 * Outside the transaction (best-effort):
 *   - Write CONSUME inventory_movements (audit)
 *   - Enqueue Shopify outbox: fulfillmentCreate, inventorySet, tagsAdd LAGER_PACKED + tagsRemove LAGER_SHIP
 *   - Trigger an allocation re-run (PACKING_DONE)
 */
export async function confirmPacking(
  orderId: string,
  userId: string,
  tracking?: TrackingInput,
): Promise<ConfirmPackingResult> {
  const db = adminDb();
  const orderRef = db.collection(Collections.Orders).doc(orderId);

  const preSnap = await orderRef.get();
  if (!preSnap.exists) throw new TransitionError("order_not_found");
  const preOrder = preSnap.data() as Order;
  const shopId = preOrder.shop_id;
  if (!shopId) throw new Error("order has no shop_id");

  const lagerCfg = await loadLagerConfig(shopId);
  const batchesEnabled = lagerCfg.batches_enabled;

  // Charge assignment happens at slip print; ensure it here too when enabled.
  if (batchesEnabled) {
    await assignBatchesForOrder(orderId);
  }

  const {
    consumedQtyByBatch,
    consumedQtyByVariant,
    lineItems,
    effectiveTracking,
  } = await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new TransitionError("order_not_found");
      const order = orderSnap.data() as Order;
      if (order.internal_status !== "PICKING") {
        throw new TransitionError(
          "not_in_picking_state",
          `Order ist in Status "${order.internal_status}", erwartet "PICKING".`,
        );
      }

      const allocSnap = await tx.get(
        db
          .collection(Collections.Allocations)
          .where("order_id", "==", orderId),
      );
      const allAllocs = allocSnap.docs.map((d) => d.data() as Allocation);
      if (orderHasActiveConsumption(allAllocs)) {
        throw new TransitionError(
          "already_consumed",
          "Bestand wurde für diese Order bereits abgezogen.",
        );
      }

      const consumedByBatch: Record<string, number> = {};
      const consumedByVariant: Record<string, number> = {};

      if (batchesEnabled) {
        const openAllocs = allocSnap.docs
          .map((d) => ({ ref: d.ref, data: d.data() as Allocation }))
          .filter((a) => !a.data.consumed_at);

        if (openAllocs.length === 0) {
          throw new TransitionError("no_open_allocations");
        }

        const variantIds = Array.from(
          new Set(openAllocs.map((a) => a.data.variant_id)),
        );
        const variantRefs = variantIds.map((id) =>
          db.collection(Collections.Variants).doc(id),
        );
        const variantSnaps = await Promise.all(
          variantRefs.map((r) => tx.get(r)),
        );
        const variantById = new Map<
          string,
          {
            ref: FirebaseFirestore.DocumentReference;
            onHand: number;
            reserved: number;
          }
        >();
        for (let i = 0; i < variantIds.length; i++) {
          const snap = variantSnaps[i];
          if (!snap?.exists) {
            throw new TransitionError(
              "batch_inconsistency",
              `variant ${variantIds[i]} existiert nicht mehr`,
            );
          }
          const d = snap.data() ?? {};
          const ref = variantRefs[i];
          if (!ref) throw new Error("variantRefs index out of bounds");
          variantById.set(variantIds[i] as string, {
            ref,
            onHand: (d.on_hand_total as number) ?? 0,
            reserved: (d.reserved_total as number) ?? 0,
          });
        }

        for (const a of openAllocs) {
          consumedByBatch[a.data.batch_id] =
            (consumedByBatch[a.data.batch_id] ?? 0) + a.data.qty;
          consumedByVariant[a.data.variant_id] =
            (consumedByVariant[a.data.variant_id] ?? 0) + a.data.qty;
        }

        for (const a of openAllocs) {
          tx.update(a.ref, { consumed_at: FieldValue.serverTimestamp() });
        }

        for (const [variantId, qty] of Object.entries(consumedByVariant)) {
          const v = variantById.get(variantId);
          if (!v) continue;
          const nextOnHand = v.onHand - qty;
          const nextReserved = Math.max(0, v.reserved - qty);
          tx.update(v.ref, {
            on_hand_total: nextOnHand,
            reserved_total: nextReserved,
            available: nextOnHand - nextReserved,
            updated_at: FieldValue.serverTimestamp(),
          });
        }
      } else {
        const variantIds = Array.from(
          new Set(order.line_items.map((li) => li.variant_id)),
        );
        const variantRefs = variantIds.map((id) =>
          db.collection(Collections.Variants).doc(id),
        );
        const variantSnaps = await Promise.all(
          variantRefs.map((r) => tx.get(r)),
        );
        const variantById = new Map<
          string,
          {
            ref: FirebaseFirestore.DocumentReference;
            onHand: number;
            reserved: number;
          }
        >();
        for (let i = 0; i < variantIds.length; i++) {
          const snap = variantSnaps[i];
          if (!snap?.exists) {
            throw new TransitionError(
              "batch_inconsistency",
              `variant ${variantIds[i]} existiert nicht mehr`,
            );
          }
          const d = snap.data() ?? {};
          const ref = variantRefs[i];
          if (!ref) throw new Error("variantRefs index out of bounds");
          variantById.set(variantIds[i] as string, {
            ref,
            onHand: (d.on_hand_total as number) ?? 0,
            reserved: (d.reserved_total as number) ?? 0,
          });
        }

        for (const li of order.line_items) {
          consumedByVariant[li.variant_id] =
            (consumedByVariant[li.variant_id] ?? 0) + li.qty;
        }

        for (const [variantId, qty] of Object.entries(consumedByVariant)) {
          const v = variantById.get(variantId);
          if (!v) continue;
          const nextOnHand = v.onHand - qty;
          const nextReserved = Math.max(0, v.reserved - qty);
          tx.update(v.ref, {
            on_hand_total: nextOnHand,
            reserved_total: nextReserved,
            available: nextOnHand - nextReserved,
            updated_at: FieldValue.serverTimestamp(),
          });
        }
      }

      const dhl = order.dhl_shipment;
      const effectiveTracking: TrackingInput | undefined = (() => {
        if (tracking?.number) return tracking;
        if (dhl?.shipment_no) {
          return {
            carrier: tracking?.carrier || "DHL",
            number: dhl.shipment_no,
            url: tracking?.url || dhl.tracking_url,
          };
        }
        return tracking;
      })();

      const orderUpdate: Record<string, unknown> = {
        internal_status: "PACKED",
        packed_at: FieldValue.serverTimestamp(),
        packed_by_uid: userId,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (effectiveTracking) orderUpdate.tracking = effectiveTracking;
      tx.update(orderRef, orderUpdate);

      return {
        consumedQtyByBatch: consumedByBatch,
        consumedQtyByVariant: consumedByVariant,
        lineItems: order.line_items,
        effectiveTracking,
      };
    });

  // ---- Outside-tx side effects (best-effort, idempotent via outbox) ----
  await writeAudit(
    orderId,
    userId,
    shopId,
    consumedQtyByBatch,
    consumedQtyByVariant,
  );
  await queueShopifyOutbox(
    orderId,
    shopId,
    lineItems,
    effectiveTracking,
    consumedQtyByVariant,
  );

  // Drain Shopify outbox synchronously so the merchant sees the order as
  // Fulfilled by the time this server action returns. (Otherwise the
  // serverless container can be killed before the background drain runs.)
  try {
    const { processOutbox } = await import("@/server/shopify/outbox");
    await processOutbox(20);
  } catch (e) {
    log.warn("packing_outbox_drain_failed", { error: String(e) });
  }

  await enqueueAllocationRun({
    shopId,
    triggeredBy: "PACKING_DONE",
    triggerEventId: orderId,
  });

  log.info("packing_confirmed", {
    orderId,
    userId,
    consumedQtyByBatch,
    consumedQtyByVariant,
  });

  return { consumedQtyByBatch, consumedQtyByVariant };
}

async function writeAudit(
  orderId: string,
  userId: string,
  shopId: string,
  byBatch: Record<string, number>,
  byVariant: Record<string, number>,
): Promise<void> {
  const db = adminDb();
  let batch = db.batch();
  let ops = 0;
  for (const [batchId, qty] of Object.entries(byBatch)) {
    const bSnap = await db
      .collection(Collections.Batches)
      .doc(batchId)
      .get();
    if (!bSnap.exists) continue;
    const variantId = (bSnap.data()?.variant_id as string) ?? "";
    const movRef = db.collection(Collections.InventoryMovements).doc();
    batch.set(movRef, {
      id: movRef.id,
      shop_id: shopId,
      type: "CONSUME",
      batch_id: batchId,
      variant_id: variantId,
      qty: -qty,
      ref: { kind: "ORDER", id: orderId },
      user_id: userId,
      created_at: FieldValue.serverTimestamp(),
    });
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (Object.keys(byBatch).length === 0) {
    for (const [variantId, qty] of Object.entries(byVariant)) {
      const movRef = db.collection(Collections.InventoryMovements).doc();
      batch.set(movRef, {
        id: movRef.id,
        shop_id: shopId,
        type: "CONSUME",
        batch_id: null,
        variant_id: variantId,
        qty: -qty,
        ref: { kind: "ORDER", id: orderId },
        user_id: userId,
        created_at: FieldValue.serverTimestamp(),
      });
      ops++;
      if (ops >= 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }
  if (ops > 0) await batch.commit();
}

async function queueShopifyOutbox(
  orderId: string,
  shopId: string,
  lineItems: Order["line_items"],
  tracking: TrackingInput | undefined,
  consumedQtyByVariant: Record<string, number>,
): Promise<void> {
  const db = adminDb();
  let batch = db.batch();
  let ops = 0;
  const now = FieldValue.serverTimestamp();

  // Fulfillment create
  {
    const ref = db.collection(Collections.ShopifyOutbox).doc();
    batch.set(ref, {
      id: ref.id,
      op: "FULFILLMENT_CREATE",
      payload: {
        orderId,
        tracking: tracking
          ? {
              company: tracking.carrier,
              number: tracking.number,
              url: tracking.url,
            }
          : undefined,
        notifyCustomer: true,
      },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    ops++;
  }

  // Tag swap: SHIP → PACKED
  {
    const refA = db.collection(Collections.ShopifyOutbox).doc();
    batch.set(refA, {
      id: refA.id,
      op: "TAGS_ADD",
      payload: { orderId, tags: [TAG_PACKED] },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    ops++;
    const refR = db.collection(Collections.ShopifyOutbox).doc();
    batch.set(refR, {
      id: refR.id,
      op: "TAGS_REMOVE",
      payload: { orderId, tags: [TAG_SHIP] },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    ops++;
  }

  // Inventory push: one entry per (variant → new on_hand).
  // We could batch these, but the per-variant write is also fine for low traffic.
  const { isAppInventorySource } = await import("@/server/lager/config");
  const pushInventory = await isAppInventorySource(shopId);
  if (pushInventory) {
  for (const variantId of Object.keys(consumedQtyByVariant)) {
    const vSnap = await db
      .collection(Collections.Variants)
      .doc(variantId)
      .get();
    if (!vSnap.exists) continue;
    const v = vSnap.data() ?? {};
    const inventoryItemGid = v.inventory_item_gid as string | undefined;
    if (!inventoryItemGid) continue;
    const metaSnap = await db
      .collection(Collections.Config)
      .doc("shopify_meta")
      .get();
    const locationGid = metaSnap.data()?.location_gid as string | undefined;
    if (!locationGid) continue;
    const onHand = (v.on_hand_total as number) ?? 0;

    const ref = db.collection(Collections.ShopifyOutbox).doc();
    batch.set(ref, {
      id: ref.id,
      op: "INVENTORY_SET",
      payload: {
        reason: "correction",
        referenceDocumentUri: `shrymp-logistics://order/${orderId}`,
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
  }
  // Counter to keep linter happy that lineItems param is used.
  void lineItems;

  if (ops > 0) await batch.commit();
}

// Re-export for tests
export const _testing = { TAG_SHIP, TAG_PACKED };
