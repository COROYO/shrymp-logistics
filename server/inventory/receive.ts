import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";

export type ReceiveBatchInput = {
  variantId: string;
  chargeNumber: string;
  /** YYYY-MM-DD; interpreted as UTC midnight to keep things calendar-stable. */
  expiryDate: string;
  qty: number;
  userId: string;
  note?: string;
};

export type ReceiveBatchResult = {
  batchId: string;
  newOnHandTotal: number;
};

/**
 * Wareneingang: create a new batch + audit movement + increment variant total,
 * atomically in one Firestore transaction.
 *
 * Triggers an allocation re-run so any pending STOP orders that the new stock
 * could now satisfy get promoted to SHIP.
 */
export async function receiveBatch(
  input: ReceiveBatchInput,
): Promise<ReceiveBatchResult> {
  validateReceiveInput(input);

  const db = adminDb();
  const variantRef = db.collection(Collections.Variants).doc(input.variantId);
  const batchRef = db.collection(Collections.Batches).doc();
  const movementRef = db.collection(Collections.InventoryMovements).doc();

  const expiryTs = parseExpiryToTimestamp(input.expiryDate);

  const newOnHandTotal = await db.runTransaction(async (tx) => {
    const variantSnap = await tx.get(variantRef);
    if (!variantSnap.exists) {
      throw new Error(`unknown_variant:${input.variantId}`);
    }
    const variant = variantSnap.data() ?? {};
    const onHand = (variant["on_hand_total"] as number | undefined) ?? 0;
    const reserved = (variant["reserved_total"] as number | undefined) ?? 0;
    const nextOnHand = onHand + input.qty;
    const nextAvailable = nextOnHand - reserved;

    tx.set(batchRef, {
      id: batchRef.id,
      variant_id: input.variantId,
      charge_number: input.chargeNumber,
      expiry_date: expiryTs,
      initial_qty: input.qty,
      remaining_qty: input.qty,
      received_at: FieldValue.serverTimestamp(),
      received_by_uid: input.userId,
      status: "ACTIVE",
      ...(input.note ? { notes: input.note } : {}),
    });

    tx.set(movementRef, {
      id: movementRef.id,
      type: "INBOUND",
      batch_id: batchRef.id,
      variant_id: input.variantId,
      qty: input.qty,
      ref: { kind: "MANUAL", id: batchRef.id },
      user_id: input.userId,
      created_at: FieldValue.serverTimestamp(),
      ...(input.note ? { note: input.note } : {}),
    });

    tx.update(variantRef, {
      on_hand_total: nextOnHand,
      available: nextAvailable,
      updated_at: FieldValue.serverTimestamp(),
    });

    return nextOnHand;
  });

  log.info("batch_received", {
    batchId: batchRef.id,
    variantId: input.variantId,
    chargeNumber: input.chargeNumber,
    qty: input.qty,
  });

  await enqueueAllocationRun({
    triggeredBy: "INBOUND",
    triggerEventId: batchRef.id,
  });

  return { batchId: batchRef.id, newOnHandTotal };
}

function validateReceiveInput(input: ReceiveBatchInput) {
  if (!input.variantId) throw new Error("variantId required");
  if (!input.chargeNumber.trim()) throw new Error("chargeNumber required");
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error("qty must be a positive integer");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) {
    throw new Error("expiryDate must be YYYY-MM-DD");
  }
}

function parseExpiryToTimestamp(dateYmd: string): Timestamp {
  // Anchor at UTC midnight so the calendar date is stable across timezones.
  const ms = Date.UTC(
    Number(dateYmd.slice(0, 4)),
    Number(dateYmd.slice(5, 7)) - 1,
    Number(dateYmd.slice(8, 10)),
  );
  return Timestamp.fromMillis(ms);
}
