import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";

/**
 * Authoritative reserved-stock figure, computed live from order state.
 *
 * `reserved` for a variant = Σ line-item quantity over every order currently
 * in SHIP or PICKING. This is the single source of truth — `variant.reserved_total`
 * is only a denormalized cache maintained by the allocation hot-path delta and
 * can drift. Computing it from orders is drift-proof.
 *
 * Scales fine even at thousands of orders/month: the SHIP+PICKING set is
 * bounded by *un-packed* orders (packed/cancelled ones drop out), which is a
 * small working set at any instant regardless of total historical volume.
 *
 * Note: charge-level allocation docs (the ones shown on /admin/allocations)
 * only exist once a packing slip is printed, so they do NOT reflect reserved
 * stock for un-printed SHIP orders — never compute reserved from them.
 */
export type ReservedDetail = { qty: number; orderIds: Set<string> };

/**
 * Reserved quantity + the set of reserving orders, per variant. Computed from
 * SHIP/PICKING order demand (see file header).
 */
export async function loadReservedDetailByVariant(): Promise<
  Map<string, ReservedDetail>
> {
  const db = adminDb();
  const reserved = new Map<string, ReservedDetail>();

  // Two equality queries (SHIP, PICKING) rather than an `in` query so each
  // hits the simplest possible index and the result sets stay small.
  for (const status of ["SHIP", "PICKING"] as const) {
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

/** Convenience: just the reserved quantity per variant. */
export async function loadReservedByVariant(): Promise<Map<string, number>> {
  const detail = await loadReservedDetailByVariant();
  const out = new Map<string, number>();
  for (const [vid, d] of detail) out.set(vid, d.qty);
  return out;
}
