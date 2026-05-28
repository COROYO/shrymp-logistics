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

/**
 * Re-pin a single order's open allocations to the currently-oldest batches
 * (FEFO at the moment of re-allocation).
 *
 * Background: the global allocation run runs at order-create/inventory-change
 * time, but by the time the warehouse staff actually prints a packing slip,
 * a newer (younger-MHD) batch may have been received or older batches may have
 * become available again. Pick/pack happens in arbitrary order, but batches
 * MUST always be consumed oldest-first. So we re-evaluate FEFO right before
 * the slip is rendered.
 *
 * Semantics:
 *   - PACKED / CANCELLED orders are untouchable (already shipped / dead).
 *   - Orders without open allocations (NEW, STOP) are left alone — those need
 *     a full allocation run, not a re-pin.
 *   - Same total qty per variant ⇒ no change to variant.reserved_total,
 *     no change to batch.remaining_qty (reservations live in `allocations`
 *     only; batch totals only move on CONSUME). The only writes are
 *     allocation rows.
 *
 * Returns `true` if the assignment changed.
 */
export async function reAllocateOrder(orderId: string): Promise<boolean> {
  const db = adminDb();
  const orderSnap = await db.collection(Collections.Orders).doc(orderId).get();
  if (!orderSnap.exists) return false;
  const order = orderSnap.data() as Order;
  if (
    order.internal_status === "PACKED" ||
    order.internal_status === "CANCELLED"
  ) {
    return false;
  }
  if (!order.line_items?.length) return false;

  // Existing open allocations for this order.
  const myAllocSnap = await db
    .collection(Collections.Allocations)
    .where("order_id", "==", orderId)
    .get();
  const myOpen = myAllocSnap.docs
    .map((d) => d.data() as Allocation)
    .filter((a) => !a.consumed_at);
  if (myOpen.length === 0) return false;

  const variantIds = Array.from(
    new Set(order.line_items.map((li) => li.variant_id)),
  );

  // Active batches for involved variants.
  const batchesByVariant = new Map<string, Batch[]>();
  for (const c of chunk(variantIds, 30)) {
    const snap = await db
      .collection(Collections.Batches)
      .where("variant_id", "in", c)
      .where("status", "==", "ACTIVE")
      .get();
    for (const d of snap.docs) {
      const b = d.data() as Batch;
      if ((b.remaining_qty ?? 0) <= 0) continue;
      const list = batchesByVariant.get(b.variant_id) ?? [];
      list.push(b);
      batchesByVariant.set(b.variant_id, list);
    }
  }

  // Open allocations against those variants — held by OTHER orders.
  // Subtract from each batch's physical remaining to get the truly available
  // share this order may compete for.
  const reservedByBatchOthers = new Map<string, number>();
  for (const c of chunk(variantIds, 30)) {
    const snap = await db
      .collection(Collections.Allocations)
      .where("variant_id", "in", c)
      .get();
    for (const d of snap.docs) {
      const a = d.data() as Allocation;
      if (a.consumed_at) continue; // packed or released
      if (a.order_id === orderId) continue; // our own — replaced below
      reservedByBatchOthers.set(
        a.batch_id,
        (reservedByBatchOthers.get(a.batch_id) ?? 0) + a.qty,
      );
    }
  }

  // FEFO pool: per variant, batches sorted (expiry ASC, charge ASC), each
  // carrying the available headroom this order may pull from.
  type PoolEntry = {
    id: string;
    available: number;
    expiry: number;
    chargeNumber: string;
  };
  const pool = new Map<string, PoolEntry[]>();
  for (const [vid, batches] of batchesByVariant) {
    const entries: PoolEntry[] = batches
      .map((b) => ({
        id: b.id,
        available: b.remaining_qty - (reservedByBatchOthers.get(b.id) ?? 0),
        expiry: toMs(b.expiry_date),
        chargeNumber: b.charge_number,
      }))
      .filter((e) => e.available > 0)
      .sort(
        (a, b) =>
          a.expiry - b.expiry || a.chargeNumber.localeCompare(b.chargeNumber),
      );
    pool.set(vid, entries);
  }

  // Greedy FEFO over this order's line items.
  type NewAlloc = {
    lineItemId: string;
    variantId: string;
    batchId: string;
    qty: number;
  };
  const newAllocs: NewAlloc[] = [];
  for (const li of order.line_items) {
    let need = li.qty;
    const entries = pool.get(li.variant_id) ?? [];
    for (const e of entries) {
      if (need === 0) break;
      if (e.available <= 0) continue;
      const take = Math.min(e.available, need);
      e.available -= take;
      need -= take;
      newAllocs.push({
        lineItemId: li.id,
        variantId: li.variant_id,
        batchId: e.id,
        qty: take,
      });
    }
    if (need > 0) {
      log.warn("realloc_one_insufficient", {
        orderId,
        variantId: li.variant_id,
        missing: need,
      });
      return false; // Keep existing assignment; don't break the order.
    }
  }

  // Short-circuit if the FEFO pick is identical to what's already on disk.
  if (sameAssignment(myOpen, newAllocs)) return false;

  // Commit: replace old allocations with the FEFO-fresh ones. No variant /
  // batch counters move — totals per variant are unchanged.
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };
  for (const a of myOpen) {
    batch.delete(db.collection(Collections.Allocations).doc(a.id));
    ops++;
    if (ops >= 450) await flush();
  }
  for (const a of newAllocs) {
    const ref = db.collection(Collections.Allocations).doc();
    batch.set(ref, {
      id: ref.id,
      order_id: orderId,
      line_item_id: a.lineItemId,
      variant_id: a.variantId,
      batch_id: a.batchId,
      qty: a.qty,
      run_id: "realloc-on-slip",
      created_at: FieldValue.serverTimestamp(),
    });
    ops++;
    if (ops >= 450) await flush();
  }
  await flush();

  log.info("order_reallocated_on_slip", {
    orderId,
    oldCount: myOpen.length,
    newCount: newAllocs.length,
  });
  return true;
}

function sameAssignment(
  existing: Allocation[],
  next: { lineItemId: string; batchId: string; qty: number }[],
): boolean {
  if (existing.length !== next.length) return false;
  const key = (lineItemId: string, batchId: string, qty: number) =>
    `${lineItemId}|${batchId}|${qty}`;
  const a = new Set(
    existing.map((x) => key(x.line_item_id, x.batch_id, x.qty)),
  );
  for (const x of next) {
    if (!a.has(key(x.lineItemId, x.batchId, x.qty))) return false;
  }
  return true;
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
