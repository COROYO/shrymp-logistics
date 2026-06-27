import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";
import { ordersForShop } from "@/server/tenant/queries";
import { normalizeShopId } from "@/server/tenant/id";

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
  shopId?: string,
): Promise<Map<string, ReservedDetail>> {
  const db = adminDb();
  const reserved = new Map<string, ReservedDetail>();
  const normalizedShop = shopId ? normalizeShopId(shopId) : null;

  // Status queries are independent — run them in parallel instead of serially.
  const snaps = await Promise.all(
    statuses.map((status) => {
      const base = normalizedShop
        ? ordersForShop(db, normalizedShop)
        : db.collection(Collections.Orders);
      return base.where("internal_status", "==", status).get();
    }),
  );

  for (const snap of snaps) {
    for (const d of snap.docs) {
      const o = d.data() as Order;
      if (normalizedShop && o.shop_id && o.shop_id !== normalizedShop) continue;
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

export async function loadReservedDetailByVariant(
  shopId?: string,
): Promise<Map<string, ReservedDetail>> {
  return loadDemandDetailByVariant(RESERVED_ORDER_STATUSES, shopId);
}

export async function loadReservedByVariant(
  shopId?: string,
): Promise<Map<string, number>> {
  const detail = await loadReservedDetailByVariant(shopId);
  const out = new Map<string, number>();
  for (const [vid, d] of detail) out.set(vid, d.qty);
  return out;
}

export async function loadOrderDemandByVariant(
  shopId?: string,
): Promise<Map<string, number>> {
  const detail = await loadDemandDetailByVariant(ORDER_DEMAND_STATUSES, shopId);
  const out = new Map<string, number>();
  for (const [vid, d] of detail) out.set(vid, d.qty);
  return out;
}
