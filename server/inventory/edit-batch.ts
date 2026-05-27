import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Batch } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { queueInventoryPush } from "./sync-to-shopify";
import { processOutbox } from "@/server/shopify/outbox";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";

export class BatchEditError extends Error {
  constructor(
    public readonly code:
      | "batch_not_found"
      | "remaining_below_reserved"
      | "qty_negative"
      | "invalid_date"
      | "cannot_edit_consumed",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BatchEditError";
  }
}

export type EditBatchInput = {
  charge_number?: string;
  /** YYYY-MM-DD */
  expiry_date?: string;
  /** New remaining qty. Net delta vs. previous is written as an ADJUSTMENT movement. */
  remaining_qty?: number;
  status?: "ACTIVE" | "DEPLETED" | "EXPIRED";
  notes?: string | null;
};

export async function editBatch(
  batchId: string,
  patch: EditBatchInput,
  userId: string,
): Promise<{ variantId: string; delta: number }> {
  if (
    patch.expiry_date !== undefined &&
    !/^\d{4}-\d{2}-\d{2}$/.test(patch.expiry_date)
  ) {
    throw new BatchEditError("invalid_date");
  }
  if (patch.remaining_qty !== undefined && patch.remaining_qty < 0) {
    throw new BatchEditError("qty_negative");
  }

  const db = adminDb();
  const batchRef = db.collection(Collections.Batches).doc(batchId);
  const movRef = db.collection(Collections.InventoryMovements).doc();

  const { variantId, delta } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(batchRef);
    if (!snap.exists) throw new BatchEditError("batch_not_found");
    const before = snap.data() as Batch;

    const variantRef = db
      .collection(Collections.Variants)
      .doc(before.variant_id);
    const vSnap = await tx.get(variantRef);

    const update: Record<string, unknown> = {};
    let delta = 0;

    if (
      patch.charge_number !== undefined &&
      patch.charge_number !== before.charge_number
    ) {
      update.charge_number = patch.charge_number;
    }
    if (patch.expiry_date !== undefined) {
      const ms = Date.UTC(
        Number(patch.expiry_date.slice(0, 4)),
        Number(patch.expiry_date.slice(5, 7)) - 1,
        Number(patch.expiry_date.slice(8, 10)),
      );
      update.expiry_date = Timestamp.fromMillis(ms);
    }
    if (
      patch.remaining_qty !== undefined &&
      patch.remaining_qty !== before.remaining_qty
    ) {
      delta = patch.remaining_qty - before.remaining_qty;
      update.remaining_qty = patch.remaining_qty;
      // Auto-DEPLETED if zero, else ACTIVE (unless caller explicitly set status).
      if (patch.status === undefined) {
        update.status = patch.remaining_qty === 0 ? "DEPLETED" : "ACTIVE";
      }
    }
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.notes !== undefined) {
      if (patch.notes === null) update.notes = FieldValue.delete();
      else update.notes = patch.notes;
    }

    if (Object.keys(update).length === 0) {
      return { variantId: before.variant_id, delta: 0 };
    }

    // Sanity: remaining_qty must not drop below currently-reserved (per the
    // open allocations against THIS batch). We approximate via the variant's
    // reserved_total — exact per-batch reservation isn't tracked at the
    // variant doc level, so use the var total as a guardrail floor.
    if (patch.remaining_qty !== undefined && vSnap.exists) {
      const reserved =
        (vSnap.data()?.["reserved_total"] as number | undefined) ?? 0;
      const onHandAfter =
        ((vSnap.data()?.["on_hand_total"] as number | undefined) ?? 0) + delta;
      if (onHandAfter < reserved) {
        throw new BatchEditError(
          "remaining_below_reserved",
          `Bestand wäre ${onHandAfter}, reserviert sind aber ${reserved} Stk in offenen Orders.`,
        );
      }
    }

    tx.update(batchRef, update);

    if (delta !== 0 && vSnap.exists) {
      const onHand =
        (vSnap.data()?.["on_hand_total"] as number | undefined) ?? 0;
      const reserved =
        (vSnap.data()?.["reserved_total"] as number | undefined) ?? 0;
      const nextOnHand = onHand + delta;
      tx.update(variantRef, {
        on_hand_total: nextOnHand,
        available: nextOnHand - reserved,
        updated_at: FieldValue.serverTimestamp(),
      });

      tx.set(movRef, {
        id: movRef.id,
        type: "ADJUSTMENT",
        batch_id: batchId,
        variant_id: before.variant_id,
        qty: delta, // signed
        ref: { kind: "MANUAL", id: batchId },
        user_id: userId,
        note: patch.notes ?? undefined,
        created_at: FieldValue.serverTimestamp(),
      });
    }

    return { variantId: before.variant_id, delta };
  });

  log.info("batch_edited", { batchId, patch, delta, userId });

  if (delta !== 0) {
    // Push new inventory to Shopify (idempotent through outbox).
    await queueInventoryPush(
      variantId,
      "correction",
      `monolith-lager://batch/${batchId}/edit`,
    );
    // Drain BEFORE returning so the serverless container doesn't kill the
    // background promise. User waits ~1-2s but Shopify is synced when the
    // success message appears.
    try {
      await processOutbox(20);
    } catch (e) {
      log.warn("edit_outbox_drain_failed", { error: String(e) });
    }
    // Re-allocate: maybe a STOP order can ship now (delta > 0) or
    // an existing SHIP needs to fall back (delta < 0).
    await enqueueAllocationRun({
      triggeredBy: "INBOUND",
      triggerEventId: batchId,
    });
  }

  return { variantId, delta };
}

export async function archiveBatch(
  batchId: string,
  userId: string,
): Promise<{ variantId: string }> {
  const db = adminDb();
  const batchRef = db.collection(Collections.Batches).doc(batchId);
  const movRef = db.collection(Collections.InventoryMovements).doc();

  const variantId = await db.runTransaction(async (tx) => {
    const snap = await tx.get(batchRef);
    if (!snap.exists) throw new BatchEditError("batch_not_found");
    const before = snap.data() as Batch;

    const remaining = before.remaining_qty;
    const variantRef = db
      .collection(Collections.Variants)
      .doc(before.variant_id);
    const vSnap = await tx.get(variantRef);

    // Disallow archiving with remaining > 0 if that would create negative
    // available stock (because of open reservations).
    if (remaining > 0 && vSnap.exists) {
      const reserved =
        (vSnap.data()?.["reserved_total"] as number | undefined) ?? 0;
      const onHand =
        (vSnap.data()?.["on_hand_total"] as number | undefined) ?? 0;
      if (onHand - remaining < reserved) {
        throw new BatchEditError(
          "remaining_below_reserved",
          `Bestand würde ${onHand - remaining} fallen, reserviert sind aber ${reserved} Stk.`,
        );
      }
    }

    tx.update(batchRef, {
      remaining_qty: 0,
      status: "DEPLETED",
    });

    if (vSnap.exists && remaining > 0) {
      const onHand =
        (vSnap.data()?.["on_hand_total"] as number | undefined) ?? 0;
      const reserved =
        (vSnap.data()?.["reserved_total"] as number | undefined) ?? 0;
      const nextOnHand = onHand - remaining;
      tx.update(variantRef, {
        on_hand_total: nextOnHand,
        available: nextOnHand - reserved,
        updated_at: FieldValue.serverTimestamp(),
      });

      tx.set(movRef, {
        id: movRef.id,
        type: "ADJUSTMENT",
        batch_id: batchId,
        variant_id: before.variant_id,
        qty: -remaining,
        ref: { kind: "MANUAL", id: batchId },
        user_id: userId,
        note: "archive_batch",
        created_at: FieldValue.serverTimestamp(),
      });
    }

    return before.variant_id;
  });

  log.info("batch_archived", { batchId, userId });

  await queueInventoryPush(
    variantId,
    "correction",
    `monolith-lager://batch/${batchId}/archive`,
  );
  try {
    await processOutbox(20);
  } catch (e) {
    log.warn("archive_outbox_drain_failed", { error: String(e) });
  }
  await enqueueAllocationRun({
    triggeredBy: "INBOUND",
    triggerEventId: batchId,
  });

  return { variantId };
}
