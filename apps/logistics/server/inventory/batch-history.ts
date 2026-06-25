import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type InventoryMovement,
  type Order,
  type User,
} from "@/server/firestore/schema";

export type BatchHistoryEntry = {
  id: string;
  type: InventoryMovement["type"] | "SALE";
  /** Signed: +N = Zugang, -N = Abgang. */
  qty: number;
  note: string | null;
  userName: string | null;
  refKind: string;
  refId: string;
  createdAtIso: string | null;
};

function tsToIso(t: unknown): string | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  return null;
}

/**
 * Movement types that represent a real, *physical* stock change AND have a
 * dedicated `inventory_movements` record: goods-receipt, manual corrections,
 * externally-detected drift.
 *
 * CONSUME is intentionally NOT sourced from `inventory_movements` here — sales
 * are derived from consumed allocations instead (see below). Not every sale
 * path writes a CONSUME movement (external Shopify fulfillment consumes the
 * allocation directly), so the allocations are the authoritative, complete
 * source — and they match the "Verkauft" column exactly.
 *
 * RESERVE / RELEASE are reservation bookkeeping (they never touch the batch's
 * physical `remaining_qty`) and the allocation churn would flood the history,
 * so they're excluded.
 */
const MOVEMENT_TYPES = [
  "INBOUND", // Wareneingang
  "ADJUSTMENT", // manuelle Korrektur (+/-)
  "EXTERNAL_DRIFT", // extern erkannte Abweichung
] as const;

/**
 * Physical history for a single batch, newest first:
 *   - goods-receipt / corrections / drift from `inventory_movements`
 *   - sales derived from consumed (not released) allocations
 *
 * `user_id` is resolved to a human-readable name where possible.
 */
export async function getBatchHistory(
  batchId: string,
  limit = 200,
): Promise<BatchHistoryEntry[]> {
  const db = adminDb();

  const [movSnap, allocSnap] = await Promise.all([
    db
      .collection(Collections.InventoryMovements)
      .where("batch_id", "==", batchId)
      .where("type", "in", [...MOVEMENT_TYPES])
      .orderBy("created_at", "desc")
      .limit(limit)
      .get(),
    // Sales = consumed, non-released allocations for this batch.
    db.collection(Collections.Allocations).where("batch_id", "==", batchId).get(),
  ]);

  const movements = movSnap.docs.map((d) => d.data() as InventoryMovement);
  const sales = allocSnap.docs
    .map((d) => d.data() as Allocation)
    .filter((a) => a.consumed_at && !a.released);

  if (movements.length === 0 && sales.length === 0) return [];

  // ---- Resolve the orders behind sales (for name + packer) ----
  const orderIds = Array.from(new Set(sales.map((a) => a.order_id)));
  const orderById = new Map<string, Order>();
  if (orderIds.length > 0) {
    const orderSnaps = await db.getAll(
      ...orderIds.map((id) => db.collection(Collections.Orders).doc(id)),
    );
    for (const o of orderSnaps) {
      if (o.exists) orderById.set(o.id, o.data() as Order);
    }
  }

  // ---- Resolve user ids → names (movement authors + sale packers) ----
  const uids = new Set<string>();
  for (const m of movements) {
    if (m.user_id && m.user_id !== "shopify") uids.add(m.user_id);
  }
  for (const a of sales) {
    const packer = orderById.get(a.order_id)?.packed_by_uid;
    if (packer && packer !== "shopify") uids.add(packer);
  }
  const userNameByUid = new Map<string, string>();
  if (uids.size > 0) {
    const userSnaps = await db.getAll(
      ...[...uids].map((id) => db.collection(Collections.Users).doc(id)),
    );
    for (const u of userSnaps) {
      if (!u.exists) continue;
      const data = u.data() as User;
      userNameByUid.set(u.id, data.display_name || data.email || u.id);
    }
  }
  const resolveActor = (uid: string | null | undefined): string | null =>
    uid === "shopify"
      ? "Shopify"
      : uid
        ? (userNameByUid.get(uid) ?? uid)
        : null;

  const entries: BatchHistoryEntry[] = [];

  for (const m of movements) {
    entries.push({
      id: m.id,
      type: m.type,
      qty: m.qty,
      note: m.note ?? null,
      userName: resolveActor(m.user_id),
      refKind: m.ref?.kind ?? "MANUAL",
      refId: m.ref?.id ?? "",
      createdAtIso: tsToIso(m.created_at),
    });
  }

  for (const a of sales) {
    const order = orderById.get(a.order_id);
    entries.push({
      id: a.id,
      type: "SALE",
      qty: -a.qty, // outflow
      note: order?.name ?? `#${a.order_id}`,
      userName: resolveActor(order?.packed_by_uid),
      refKind: "ORDER",
      refId: a.order_id,
      // Prefer when it was packed (consumed); fall back to allocation time.
      createdAtIso: tsToIso(a.consumed_at) ?? tsToIso(a.created_at),
    });
  }

  // Newest first across both sources.
  entries.sort((a, b) => {
    const am = a.createdAtIso ? Date.parse(a.createdAtIso) : 0;
    const bm = b.createdAtIso ? Date.parse(b.createdAtIso) : 0;
    return bm - am;
  });

  return entries.slice(0, limit);
}
