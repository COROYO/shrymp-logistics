import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Batch, type Order } from "@/server/firestore/schema";
import {
  isBatchAssignableForShipping,
  isBatchExpired,
  toEpochMs,
} from "./batch-assignability";

export type BatchAssignBlockReason =
  | "BATCH_EXPIRED"
  | "BATCH_NEAR_EXPIRY"
  | "INSUFFICIENT_STOCK";

export type BatchAssignFeasibility =
  | { assignable: true }
  | { assignable: false; reason: BatchAssignBlockReason };

type PoolEntry = {
  remaining: number;
  expiry: number;
  chargeNumber: string;
};

/**
 * Pure FEFO simulation: can every line item be covered from assignable Chargen?
 * Mirrors assign-batches.ts without writes.
 */
export function evaluateBatchAssignFeasibility(
  lineItems: Order["line_items"],
  batches: Batch[],
  minDaysBeforeExpiry: number,
  referenceDate: Date = new Date(),
): BatchAssignFeasibility {
  const batchesByVariant = new Map<string, Batch[]>();
  for (const b of batches) {
    if ((b.remaining_qty ?? 0) <= 0) continue;
    const list = batchesByVariant.get(b.variant_id);
    if (list) list.push(b);
    else batchesByVariant.set(b.variant_id, [b]);
  }

  const pool = new Map<string, PoolEntry[]>();
  for (const [variantId, variantBatches] of batchesByVariant) {
    const entries: PoolEntry[] = [];
    for (const b of variantBatches) {
      if (
        !isBatchAssignableForShipping(
          b.expiry_date,
          minDaysBeforeExpiry,
          referenceDate,
        )
      ) {
        continue;
      }
      entries.push({
        remaining: b.remaining_qty ?? 0,
        expiry: toEpochMs(b.expiry_date),
        chargeNumber: b.charge_number,
      });
    }
    entries.sort(
      (a, b) =>
        a.expiry - b.expiry || a.chargeNumber.localeCompare(b.chargeNumber),
    );
    pool.set(variantId, entries);
  }

  for (const li of lineItems) {
    let need = li.qty;
    const entries = pool.get(li.variant_id) ?? [];
    for (const e of entries) {
      if (need === 0) break;
      if (e.remaining <= 0) continue;
      const take = Math.min(e.remaining, need);
      e.remaining -= take;
      need -= take;
    }
    if (need > 0) {
      const withStock = (batchesByVariant.get(li.variant_id) ?? []).filter(
        (b) => (b.remaining_qty ?? 0) > 0,
      );
      if (
        withStock.some((b) => isBatchExpired(b.expiry_date, referenceDate))
      ) {
        return { assignable: false, reason: "BATCH_EXPIRED" };
      }
      if (
        withStock.some(
          (b) =>
            !isBatchAssignableForShipping(
              b.expiry_date,
              minDaysBeforeExpiry,
              referenceDate,
            ),
        )
      ) {
        return { assignable: false, reason: "BATCH_NEAR_EXPIRY" };
      }
      return { assignable: false, reason: "INSUFFICIENT_STOCK" };
    }
  }

  return { assignable: true };
}

export async function loadBatchAssignFeasibility(
  order: Order,
  minDaysBeforeExpiry: number,
  referenceDate: Date = new Date(),
): Promise<BatchAssignFeasibility> {
  const db = adminDb();
  const variantIds = Array.from(
    new Set(order.line_items.map((li) => li.variant_id)),
  );
  const batches: Batch[] = [];
  for (const c of chunk(variantIds, 30)) {
    const snap = await db
      .collection(Collections.Batches)
      .where("variant_id", "in", c)
      .where("status", "==", "ACTIVE")
      .get();
    for (const d of snap.docs) {
      batches.push(d.data() as Batch);
    }
  }
  return evaluateBatchAssignFeasibility(
    order.line_items,
    batches,
    minDaysBeforeExpiry,
    referenceDate,
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
