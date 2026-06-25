import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import { queueInventoryPush } from "./sync-to-shopify";
import { processOutbox } from "@/server/shopify/outbox";

export type ReceiveBatchInput = {
  variantId: string;
  chargeNumber: string;
  /** YYYY-MM-DD; interpreted as UTC midnight to keep things calendar-stable. */
  expiryDate: string;
  /** Optional production date, YYYY-MM-DD; UTC-midnight anchored. */
  productionDate?: string;
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

  const expiryTs = parseYmdToTimestamp(input.expiryDate);
  const productionTs = input.productionDate
    ? parseYmdToTimestamp(input.productionDate)
    : null;

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
      ...(productionTs ? { production_date: productionTs } : {}),
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

  // Push new inventory level to Shopify (idempotent via outbox).
  await queueInventoryPush(
    input.variantId,
    "received",
    `shrymp-logistics://batch/${batchRef.id}/inbound`,
  );

  // Drain BEFORE returning so the serverless container doesn't kill the
  // background promise. User waits ~1-2s but Shopify is synced when the
  // success message appears.
  try {
    await processOutbox(20);
  } catch (e) {
    log.warn("inbound_outbox_drain_failed", { error: String(e) });
  }

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
  if (
    input.productionDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(input.productionDate)
  ) {
    throw new Error("productionDate must be YYYY-MM-DD");
  }
}

function parseYmdToTimestamp(dateYmd: string): Timestamp {
  // Anchor at UTC midnight so the calendar date is stable across timezones.
  const ms = Date.UTC(
    Number(dateYmd.slice(0, 4)),
    Number(dateYmd.slice(5, 7)) - 1,
    Number(dateYmd.slice(8, 10)),
  );
  return Timestamp.fromMillis(ms);
}
