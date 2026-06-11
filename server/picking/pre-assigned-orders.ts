import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import { loadLagerConfig } from "@/server/lager/config";
import { isBatchAssignableForShipping } from "./batch-assignability";
import { orderAssignmentCoversLineItems } from "./assignment-coverage";

/**
 * Orders that already have a complete, versandfähige Charge-Zuordnung. These
 * must stay SHIP without re-consuming the unassigned remaining pool.
 */
export async function loadPreAssignedShippableOrderIds(
  orders: Order[],
): Promise<Set<string>> {
  const candidates = orders.filter(
    (o) => o.internal_status === "SHIP" || o.internal_status === "PICKING",
  );
  if (candidates.length === 0) return new Set();

  const db = adminDb();
  const lagerCfg = await loadLagerConfig();
  const minDays = lagerCfg.batch_min_days_before_expiry;
  const referenceDate = new Date();
  const out = new Set<string>();

  const allocSnaps = await Promise.all(
    candidates.map((o) =>
      db
        .collection(Collections.Allocations)
        .where("order_id", "==", o.id)
        .get(),
    ),
  );

  const batchIds = new Set<string>();
  const openByOrder = new Map<string, Allocation[]>();
  for (let i = 0; i < candidates.length; i++) {
    const order = candidates[i]!;
    const open = allocSnaps[i]!
      .docs.map((d) => d.data() as Allocation)
      .filter((a) => !a.consumed_at && !a.released);
    if (!orderAssignmentCoversLineItems(order.line_items, open)) continue;
    openByOrder.set(order.id, open);
    for (const a of open) batchIds.add(a.batch_id);
  }

  if (batchIds.size === 0) return out;

  const batchSnaps = await db.getAll(
    ...[...batchIds].map((id) => db.collection(Collections.Batches).doc(id)),
  );
  const batchById = new Map<string, Batch>();
  for (const snap of batchSnaps) {
    if (snap.exists) batchById.set(snap.id, snap.data() as Batch);
  }

  for (const order of candidates) {
    const open = openByOrder.get(order.id);
    if (!open) continue;
    const allShippable = open.every((a) => {
      const b = batchById.get(a.batch_id);
      if (!b) return false;
      return isBatchAssignableForShipping(
        b.expiry_date,
        minDays,
        referenceDate,
      );
    });
    if (allShippable) out.add(order.id);
  }

  return out;
}
