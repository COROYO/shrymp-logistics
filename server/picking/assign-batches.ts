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
import { isBatchAssignableForShipping } from "./batch-assignability";

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
  const db = adminDb();
  const lagerCfg = await loadLagerConfig();
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
    const myOpen = myAllocSnap.docs
      .map((d) => ({ ref: d.ref, data: d.data() as Allocation }))
      .filter((a) => !a.data.consumed_at);

    // Already fully assigned → idempotent reprint, change nothing.
    if (myOpen.length > 0 && coversAllLineItems(order.line_items, myOpen)) {
      return true;
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
      if (
        !isBatchAssignableForShipping(
          b.expiry_date,
          minDays,
          referenceDate,
        )
      ) {
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
        const hasBlockedNearExpiry = batchDocs.some((d) => {
          const b = d.data() as Batch;
          if (b.variant_id !== li.variant_id) return false;
          if ((b.remaining_qty ?? 0) <= 0) return false;
          return !isBatchAssignableForShipping(
            b.expiry_date,
            minDays,
            referenceDate,
          );
        });
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
    // Replace any partial existing assignment.
    for (const a of myOpen) tx.delete(a.ref);

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

function coversAllLineItems(
  lineItems: Order["line_items"],
  open: { data: Allocation }[],
): boolean {
  const assignedByLi = new Map<string, number>();
  for (const a of open) {
    assignedByLi.set(
      a.data.line_item_id,
      (assignedByLi.get(a.data.line_item_id) ?? 0) + a.data.qty,
    );
  }
  for (const li of lineItems) {
    if ((assignedByLi.get(li.id) ?? 0) !== li.qty) return false;
  }
  // No stray assignments for line items that no longer exist.
  return assignedByLi.size === new Set(lineItems.map((li) => li.id)).size;
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

/** Exported for slip completeness checks. */
export function orderAssignmentCoversLineItems(
  lineItems: Order["line_items"],
  allocs: Pick<Allocation, "line_item_id" | "qty" | "consumed_at">[],
): boolean {
  const open = allocs.filter((a) => !a.consumed_at);
  return coversAllLineItems(lineItems, open.map((data) => ({ data })));
}
