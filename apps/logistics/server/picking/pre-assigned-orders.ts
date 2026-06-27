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
  shopId?: string,
): Promise<Set<string>> {
  const candidates = orders.filter(
    (o) => o.internal_status === "SHIP" || o.internal_status === "PICKING",
  );
  if (candidates.length === 0) return new Set();

  const db = adminDb();
  const lagerCfg = await loadLagerConfig(
    shopId ?? candidates[0]?.shop_id ?? undefined,
  );
  const minDays = lagerCfg.batch_min_days_before_expiry;
  const referenceDate = new Date();
  const out = new Set<string>();

  // Group allocations by order via chunked `order_id IN` queries (30 ids per
  // query) instead of one query per order.
  const candidateIds = candidates.map((o) => o.id);
  const allocsByOrderId = new Map<string, Allocation[]>();
  for (let i = 0; i < candidateIds.length; i += 30) {
    const chunk = candidateIds.slice(i, i + 30);
    const snap = await db
      .collection(Collections.Allocations)
      .where("order_id", "in", chunk)
      .get();
    for (const d of snap.docs) {
      const a = d.data() as Allocation;
      const list = allocsByOrderId.get(a.order_id);
      if (list) list.push(a);
      else allocsByOrderId.set(a.order_id, [a]);
    }
  }

  const batchIds = new Set<string>();
  const openByOrder = new Map<string, Allocation[]>();
  for (const order of candidates) {
    const open = (allocsByOrderId.get(order.id) ?? []).filter(
      (a) => !a.consumed_at && !a.released,
    );
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
