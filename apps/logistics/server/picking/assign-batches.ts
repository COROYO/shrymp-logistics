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
import { releaseUnshippableBatchAssignments } from "./release-invalid-assignments";
import { orderAssignmentCoversLineItems } from "./assignment-coverage";
import { orderHasActiveConsumption } from "./consume-guard";

export { orderAssignmentCoversLineItems } from "./assignment-coverage";

/**
 * Assign concrete Chargen (batches) to an order's line items — FEFO, oldest
 * MHD first — at the moment the packing slip is printed.
 *
 * This is the ONLY place batches get pinned. The allocation run decides
 * SHIP/STOP and reserves quantity at the variant level only; the physical
 * Charge is chosen here so that — regardless of the order in which staff pack
 * orders — whoever prints next always gets the oldest batch still on the shelf.
 *
 * The whole pick runs in ONE Firestore transaction. The batch documents are
 * the serialization point: two concurrent prints competing for the same
 * batch's last units contend on the batch doc, and one transparently retries.
 * `batch.remaining_qty` is decremented HERE (it means "assignable units"); the
 * physical on_hand only drops later at packing-confirm.
 *
 * Idempotent: a reprint reuses the assignment already on disk, so the Charge
 * on a (legal) delivery note never changes between print attempts.
 *
 * Returns:
 *   - `true`  — the order has a complete Charge assignment (created or reused).
 *   - `false` — nothing to assign (order not in SHIP/PICKING, or no line items).
 * Throws on genuine stock inconsistency (assignable stock < reserved need).
 */
export async function assignBatchesForOrder(orderId: string): Promise<boolean> {
  const lagerCfg = await loadLagerConfig();
  if (!lagerCfg.batches_enabled) return true;

  await releaseUnshippableBatchAssignments(orderId);

  const db = adminDb();
  const minDays = lagerCfg.batch_min_days_before_expiry;
  const referenceDate = new Date();

  return db.runTransaction(async (tx) => {
    const orderRef = db.collection(Collections.Orders).doc(orderId);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return false;
    const order = orderSnap.data() as Order;
    if (
      order.internal_status !== "SHIP" &&
      order.internal_status !== "PICKING"
    ) {
      return false;
    }
    if (!order.line_items?.length) return false;

    // ---- Reads (all before writes) ----
    // Existing open assignments for this order.
    const myAllocSnap = await tx.get(
      db.collection(Collections.Allocations).where("order_id", "==", orderId),
    );
    const myAllocs = myAllocSnap.docs.map((d) => d.data() as Allocation);
    // Never pin new Chargen once this order already committed stock — prevents
    // a second consume cluster even if status was wrongly reverted to SHIP.
    if (orderHasActiveConsumption(myAllocs)) {
      log.warn("assign_batches_already_consumed", { orderId });
      return false;
    }
    const myOpen = myAllocSnap.docs
      .map((d) => ({ ref: d.ref, data: d.data() as Allocation }))
      .filter((a) => !a.data.consumed_at);

    // Already fully assigned → idempotent reprint only if every pinned Charge
    // is still shippable (not expired / within the MHD cutoff).
    if (
      myOpen.length > 0 &&
      orderAssignmentCoversLineItems(order.line_items, myOpen.map((a) => a.data))
    ) {
      const assignedBatchIds = Array.from(
        new Set(myOpen.map((a) => a.data.batch_id)),
      );
      const assignedSnaps = await Promise.all(
        assignedBatchIds.map((id) =>
          tx.get(db.collection(Collections.Batches).doc(id)),
        ),
      );
      const stillShippable = assignedSnaps.every((snap) => {
        if (!snap.exists) return false;
        const b = snap.data() as Batch;
        return isBatchAssignableForShipping(
          b.expiry_date,
          minDays,
          referenceDate,
        );
      });
      if (stillShippable) return true;
    }

    // Drop stale / partial assignments so the pool sees restored remaining_qty.
    if (myOpen.length > 0) {
      await releaseOpenAssignments(tx, db, myOpen, referenceDate);
    }

    // ACTIVE batches with assignable stock for the order's variants.
    const variantIds = Array.from(
      new Set(order.line_items.map((li) => li.variant_id)),
    );
    const batchDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const c of chunk(variantIds, 30)) {
      const snap = await tx.get(
        db
          .collection(Collections.Batches)
          .where("variant_id", "in", c)
          .where("status", "==", "ACTIVE"),
      );
      batchDocs.push(...snap.docs);
    }

    // FEFO pool per variant: earliest expiry first, charge number as tiebreak.
    type PoolEntry = {
      ref: FirebaseFirestore.DocumentReference;
      id: string;
      remaining: number;
      expiry: number;
      chargeNumber: string;
    };
    const pool = new Map<string, PoolEntry[]>();
    for (const d of batchDocs) {
      const b = d.data() as Batch;
      if ((b.remaining_qty ?? 0) <= 0) continue;
      const expired = !isBatchAssignableForShipping(
        b.expiry_date,
        minDays,
        referenceDate,
      );
      if (expired) {
        if (isBatchExpired(b.expiry_date, referenceDate)) {
          tx.update(d.ref, { status: "EXPIRED" });
        }
        continue;
      }
      const entry: PoolEntry = {
        ref: d.ref,
        id: b.id,
        remaining: b.remaining_qty,
        expiry: toMs(b.expiry_date),
        chargeNumber: b.charge_number,
      };
      const list = pool.get(b.variant_id);
      if (list) list.push(entry);
      else pool.set(b.variant_id, [entry]);
    }
    for (const list of pool.values()) {
      list.sort(
        (a, b) =>
          a.expiry - b.expiry || a.chargeNumber.localeCompare(b.chargeNumber),
      );
    }

    // Greedy FEFO pick per line item.
    type Pick = { lineItemId: string; variantId: string; batchId: string; qty: number };
    const picks: Pick[] = [];
    const batchTake = new Map<string, number>(); // batchId → units to decrement
    for (const li of order.line_items) {
      let need = li.qty;
      const entries = pool.get(li.variant_id) ?? [];
      for (const e of entries) {
        if (need === 0) break;
        if (e.remaining <= 0) continue;
        const take = Math.min(e.remaining, need);
        e.remaining -= take;
        need -= take;
        picks.push({
          lineItemId: li.id,
          variantId: li.variant_id,
          batchId: e.id,
          qty: take,
        });
        batchTake.set(e.id, (batchTake.get(e.id) ?? 0) + take);
      }
      if (need > 0) {
        const variantBatches = batchDocs.filter((d) => {
          const b = d.data() as Batch;
          return (
            b.variant_id === li.variant_id && (b.remaining_qty ?? 0) > 0
          );
        });
        const hasExpiredStock = variantBatches.some((d) =>
          isBatchExpired((d.data() as Batch).expiry_date, referenceDate),
        );
        if (hasExpiredStock) {
          throw new Error(
            `assign_batches_expired_blocked: order=${orderId} variant=${li.variant_id} missing=${need}`,
          );
        }
        const hasBlockedNearExpiry = variantBatches.some(
          (d) =>
            !isBatchAssignableForShipping(
              (d.data() as Batch).expiry_date,
              minDays,
              referenceDate,
            ),
        );
        if (hasBlockedNearExpiry) {
          throw new Error(
            `assign_batches_near_expiry_blocked: order=${orderId} variant=${li.variant_id} missing=${need} minDays=${minDays}`,
          );
        }
        // Should not happen: the order is SHIP, so reserved stock exists. This
        // means external inventory drift — surface it loudly.
        throw new Error(
          `assign_batches_insufficient: order=${orderId} variant=${li.variant_id} missing=${need}`,
        );
      }
    }

    // ---- Writes ----
    const batchById = new Map(batchDocs.map((d) => [d.id, d]));
    for (const [batchId, take] of batchTake) {
      const d = batchById.get(batchId);
      if (!d) continue;
      const remaining = ((d.data() as Batch).remaining_qty ?? 0) - take;
      tx.update(d.ref, {
        remaining_qty: remaining,
        status: remaining === 0 ? "DEPLETED" : "ACTIVE",
      });
    }

    for (const p of picks) {
      const ref = db.collection(Collections.Allocations).doc();
      tx.set(ref, {
        id: ref.id,
        order_id: orderId,
        line_item_id: p.lineItemId,
        variant_id: p.variantId,
        batch_id: p.batchId,
        qty: p.qty,
        run_id: "assign-on-slip",
        created_at: FieldValue.serverTimestamp(),
      });
    }

    log.info("order_batches_assigned", {
      orderId,
      picks: picks.length,
      replaced: myOpen.length,
    });
    return true;
  });
}

async function releaseOpenAssignments(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  open: { ref: FirebaseFirestore.DocumentReference; data: Allocation }[],
  referenceDate: Date,
): Promise<void> {
  const batchIds = Array.from(new Set(open.map((a) => a.data.batch_id)));
  const batchSnaps = await Promise.all(
    batchIds.map((id) => tx.get(db.collection(Collections.Batches).doc(id))),
  );
  const batchById = new Map(
    batchSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as Batch]),
  );

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
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toMs(ts: unknown): number {
  if (ts == null) return 0;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "string") return new Date(ts).getTime();
  if (typeof ts === "object") {
    const o = ts as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof o.toMillis === "function") return o.toMillis();
    if (typeof o.seconds === "number") {
      return o.seconds * 1000 + (o.nanoseconds ?? 0) / 1e6;
    }
  }
  return 0;
}

