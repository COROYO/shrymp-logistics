import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import {
  getOrAssignLieferscheinNo,
  type LieferscheinRef,
} from "./lieferschein";
import { reAllocateOrder } from "@/server/allocation/reallocate-one";
import { log } from "@/lib/logger";

export type SlipAllocLine = {
  lineItemId: string;
  chargeNumber: string;
  expiryDateIso: string | null;
  qty: number;
};

export type SlipData = {
  order: Order;
  allocsByLi: Map<string, SlipAllocLine[]>;
  lieferschein: LieferscheinRef;
};

/**
 * Load the data needed to render a packing slip (order + allocations + batch
 * metadata). Shared between the single-slip view and the bulk-slip view.
 *
 * Returns `null` if the order doesn't exist.
 */
export async function loadSlipData(orderId: string): Promise<SlipData | null> {
  const db = adminDb();

  // Re-pin this order's allocations to the currently-oldest batches BEFORE
  // we read them. Pickers may work orders in arbitrary sequence, but each
  // slip must always print the oldest-MHD charge that's still on the shelf.
  // Best-effort: a failure here doesn't block the slip — we'll just print
  // whatever assignment was last persisted.
  try {
    await reAllocateOrder(orderId);
  } catch (e) {
    log.warn("realloc_on_slip_failed", {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const orderSnap = await db
    .collection(Collections.Orders)
    .doc(orderId)
    .get();
  if (!orderSnap.exists) return null;
  const order = orderSnap.data() as Order;

  const allocSnap = await db
    .collection(Collections.Allocations)
    .where("order_id", "==", orderId)
    .get();
  const allocs = allocSnap.docs.map((d) => d.data() as Allocation);
  const batchIds = Array.from(new Set(allocs.map((a) => a.batch_id)));
  const batchSnaps = await Promise.all(
    batchIds.map((b) => db.collection(Collections.Batches).doc(b).get()),
  );
  const batchById = new Map<string, Batch>();
  for (const b of batchSnaps) {
    if (b.exists) batchById.set(b.id, b.data() as Batch);
  }

  const allocsByLi = new Map<string, SlipAllocLine[]>();
  for (const a of allocs) {
    const b = batchById.get(a.batch_id);
    if (!b) continue;
    const exp = b.expiry_date as unknown as
      | { toDate?(): Date; seconds?: number }
      | undefined;
    let iso: string | null = null;
    if (exp && typeof (exp as { toDate?: unknown }).toDate === "function") {
      iso = (exp as { toDate(): Date }).toDate().toISOString().slice(0, 10);
    } else if (
      exp &&
      typeof (exp as { seconds?: number }).seconds === "number"
    ) {
      iso = new Date((exp as { seconds: number }).seconds * 1000)
        .toISOString()
        .slice(0, 10);
    }
    const entry: SlipAllocLine = {
      lineItemId: a.line_item_id,
      chargeNumber: b.charge_number,
      expiryDateIso: iso,
      qty: a.qty,
    };
    const list = allocsByLi.get(a.line_item_id);
    if (list) list.push(entry);
    else allocsByLi.set(a.line_item_id, [entry]);
  }

  // Assign (or reuse) Lieferschein-Nr. AFTER reading the order so we have
  // the freshest doc. The helper is itself transactional — if the order
  // already has a number the existing one comes back, otherwise a new one
  // is allocated and written through.
  const lieferschein = await getOrAssignLieferscheinNo(orderId);
  // Reflect the assignment locally so the SlipBody renders the right value
  // on the FIRST print without an extra read round-trip.
  order.lieferschein_no = lieferschein.number;

  return { order, allocsByLi, lieferschein };
}

export function tsToDate(t: unknown): Date | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate();
  if (typeof o.seconds === "number") return new Date(o.seconds * 1000);
  return null;
}
