import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";

/** Statuses that actually reserve stock (allocation + picking). */
export const RESERVED_ORDER_STATUSES = ["SHIP", "PICKING"] as const;

/** Open order demand incl. STOP — for inventory overview / Lagerbestand. */
export const ORDER_DEMAND_STATUSES = ["SHIP", "PICKING", "STOP"] as const;

/**
 * Authoritative reserved-stock figure, computed live from order state.
 *
 * `reserved` for a variant = Σ line-item quantity over every order currently
 * in SHIP or PICKING. This is the single source of truth — `variant.reserved_total`
 * is only a denormalized cache maintained by the allocation hot-path delta and
 * can drift. Computing it from orders is drift-proof.
 *
 * STOP orders are excluded here — they do not reserve stock in allocation.
 * For a demand view that includes STOP, use `loadOrderDemandByVariant`.
 *
 * Note: charge-level allocation docs (the ones shown on /admin/allocations)
 * only exist once a packing slip is printed, so they do NOT reflect reserved
 * stock for un-printed SHIP orders — never compute reserved from them.
 */
export type ReservedDetail = { qty: number; orderIds: Set<string> };

async function loadDemandDetailByVariant(
  statuses: readonly string[],
): Promise<Map<string, ReservedDetail>> {
  const db = adminDb();
  const reserved = new Map<string, ReservedDetail>();

  // One equality query per status rather than an `in` query so each hits the
  // simplest possible index and the result sets stay small.
  for (const status of statuses) {
    const snap = await db
      .collection(Collections.Orders)
      .where("internal_status", "==", status)
      .get();
    for (const d of snap.docs) {
      const o = d.data() as Order;
      for (const li of o.line_items ?? []) {
        const cur = reserved.get(li.variant_id) ?? {
          qty: 0,
          orderIds: new Set<string>(),
        };
        cur.qty += li.qty;
        cur.orderIds.add(o.id);
        reserved.set(li.variant_id, cur);
      }
    }
  }

  return reserved;
}

/**
 * Reserved quantity + the set of reserving orders, per variant. Computed from
 * SHIP/PICKING order demand (see file header).
 */
export async function loadReservedDetailByVariant(): Promise<
  Map<string, ReservedDetail>
> {
  return loadDemandDetailByVariant(RESERVED_ORDER_STATUSES);
}

/** Convenience: just the reserved quantity per variant (SHIP/PICKING). */
export async function loadReservedByVariant(): Promise<Map<string, number>> {
  const detail = await loadReservedDetailByVariant();
  const out = new Map<string, number>();
  for (const [vid, d] of detail) out.set(vid, d.qty);
  return out;
}

/** Order demand incl. STOP — for Lagerbestand "In Orders" column. */
export async function loadOrderDemandByVariant(): Promise<Map<string, number>> {
  const detail = await loadDemandDetailByVariant(ORDER_DEMAND_STATUSES);
  const out = new Map<string, number>();
  for (const [vid, d] of detail) out.set(vid, d.qty);
  return out;
}
