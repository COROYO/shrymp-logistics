import "server-only";
import type {
  DocumentSnapshot,
  Query,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { ordersForShop } from "@/server/tenant/queries";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import type {
  ChargeRow,
  OrderLineItemRow,
  OrderRow,
} from "@/app/admin/orders/orders-table";
import type { OrdersListFilter } from "@/app/admin/orders/filters";
import { UNPAID_FINANCIAL_STATUSES } from "@/server/orders/financial-status";
import { isStockLineItem, stockLineItems } from "@/lib/orders/stock-line-items";
import {
  ORDER_LIST_LIMIT,
  ORDER_SEARCH_MATCH_LIMIT,
  ORDER_SEARCH_PAGE,
  ORDER_SEARCH_SCAN_LIMIT,
  orderMatchesQuery,
} from "@/server/admin/order-search";

function tsToIso(t: unknown): string {
  if (!t) return "";
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  return "";
}

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mergeCharges(a: ChargeRow[], b: ChargeRow[]): ChargeRow[] {
  const byNumber = new Map<string, ChargeRow>();
  for (const c of [...a, ...b]) {
    const existing = byNumber.get(c.chargeNumber);
    if (existing) existing.qty += c.qty;
    else byNumber.set(c.chargeNumber, { ...c });
  }
  return Array.from(byNumber.values());
}

function mergeDuplicateLineItems(items: OrderLineItemRow[]): OrderLineItemRow[] {
  const merged: OrderLineItemRow[] = [];
  const idxByKey = new Map<string, number>();
  for (const li of items) {
    const key = `${li.custom ? "c" : "s"}|${li.bundle?.groupId ?? "_"}|${li.sku ?? "_"}|${li.title}`;
    const existingIdx = idxByKey.get(key);
    if (existingIdx === undefined) {
      idxByKey.set(key, merged.length);
      merged.push(li);
      continue;
    }
    const existing = merged[existingIdx]!;
    merged[existingIdx] = {
      ...existing,
      qty: existing.qty + li.qty,
      charges: mergeCharges(existing.charges, li.charges),
      mergedFromIds: [...existing.mergedFromIds, li.id],
    };
  }
  return merged;
}

function ordersQuery(shopId: string, filter: OrdersListFilter): Query {
  const db = adminDb();
  const base = ordersForShop(db, shopId);
  if (filter === "ALL") return base.orderBy("created_at_shopify", "desc");
  if (filter === "UNPAID") {
    return base
      .where("shopify_financial_status", "in", [...UNPAID_FINANCIAL_STATUSES])
      .orderBy("created_at_shopify", "desc");
  }
  return base
    .where("internal_status", "==", filter)
    .orderBy("created_at_shopify", "desc");
}

/**
 * Firestore has no substring index. A search walks the shop's orders (newest
 * first) and keeps the first matches. The status filter still applies.
 */
async function scanMatchingOrders(base: Query, query: string): Promise<Order[]> {
  const matches: Order[] = [];
  let scanned = 0;
  let cursor: QueryDocumentSnapshot | undefined;

  while (matches.length < ORDER_SEARCH_MATCH_LIMIT && scanned < ORDER_SEARCH_SCAN_LIMIT) {
    const pageSize = Math.min(ORDER_SEARCH_PAGE, ORDER_SEARCH_SCAN_LIMIT - scanned);
    let page = base.limit(pageSize);
    if (cursor) page = page.startAfter(cursor);
    const snap = await page.get();
    if (snap.empty) break;
    scanned += snap.size;
    for (const doc of snap.docs) {
      const order = doc.data() as Order;
      if (!orderMatchesQuery(order, query)) continue;
      matches.push(order);
      if (matches.length >= ORDER_SEARCH_MATCH_LIMIT) break;
    }
    if (snap.size < pageSize) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  return matches;
}

export async function loadOrderRows(
  filter: OrdersListFilter,
  shopId: string,
  query = "",
): Promise<OrderRow[]> {
  const base = ordersQuery(shopId, filter);
  const orders = query
    ? await scanMatchingOrders(base, query)
    : (await base.limit(ORDER_LIST_LIMIT).get()).docs.map((d) => d.data() as Order);
  if (orders.length === 0) return [];

  const db = adminDb();
  const variantIds = Array.from(
    new Set(
      orders.flatMap((o) =>
        stockLineItems(o.line_items).map((li) => li.variant_id),
      ),
    ),
  );

  const orderIdChunks = chunkIds(
    orders.map((o) => o.id),
    30,
  );

  const variantRefs = variantIds.map((id) =>
    db.collection(Collections.Variants).doc(id),
  );

  const [lagerCfg, variantSnaps, allocSnaps] = await Promise.all([
    import("@/server/lager/config").then(({ loadLagerConfig }) =>
      loadLagerConfig(shopId),
    ),
    variantIds.length > 0
      ? db.getAll(...variantRefs)
      : Promise.resolve([] as DocumentSnapshot[]),
    orderIdChunks.length > 0
      ? Promise.all(
          orderIdChunks.map((c) =>
            db
              .collection(Collections.Allocations)
              .where("order_id", "in", c)
              .get(),
          ),
        )
      : Promise.resolve([]),
  ]);

  const variantById = new Map<string, Variant>();
  for (const v of variantSnaps) {
    if (v.exists) variantById.set(v.id, v.data() as Variant);
  }

  const productIds = Array.from(
    new Set(
      Array.from(variantById.values())
        .map((v) => v.product_id)
        .filter(Boolean),
    ),
  );

  const [productSnaps, shippableByVariant] = await Promise.all([
    productIds.length > 0
      ? db.getAll(
          ...productIds.map((id) =>
            db.collection(Collections.Products).doc(id),
          ),
        )
      : Promise.resolve([] as DocumentSnapshot[]),
    lagerCfg.batches_enabled
      ? import("@/server/inventory/shippable-stock").then(
          ({ loadShippableQtyByVariant }) =>
            loadShippableQtyByVariant(variantIds, shopId, lagerCfg),
        )
      : Promise.resolve(null as Map<string, number> | null),
  ]);

  const productById = new Map<string, Product>();
  for (const p of productSnaps) {
    if (p.exists) productById.set(p.id, p.data() as Product);
  }

  const chargesByOrderLine = new Map<string, Map<string, ChargeRow[]>>();
  const allocs = allocSnaps
    .flatMap((s) => s.docs.map((d) => d.data() as Allocation))
    .filter((a) => !a.released);
  if (allocs.length > 0) {
    const batchIds = Array.from(new Set(allocs.map((a) => a.batch_id)));
    const batchSnaps = await db.getAll(
      ...batchIds.map((id) => db.collection(Collections.Batches).doc(id)),
    );
    const batchById = new Map<string, Batch>();
    for (const b of batchSnaps) {
      if (b.exists) batchById.set(b.id, b.data() as Batch);
    }
    for (const a of allocs) {
      const b = batchById.get(a.batch_id);
      if (!b) continue;
      const byLine =
        chargesByOrderLine.get(a.order_id) ?? new Map<string, ChargeRow[]>();
      const list = byLine.get(a.line_item_id) ?? [];
      list.push({
        chargeNumber: b.charge_number,
        expiryIso: tsToIso(b.expiry_date) || null,
        qty: a.qty,
      });
      byLine.set(a.line_item_id, list);
      chargesByOrderLine.set(a.order_id, byLine);
    }
  }

  return orders.map<OrderRow>((o) => {
    const chargesByLine = chargesByOrderLine.get(o.id);
    const itemCount = o.line_items.reduce((sum, li) => sum + li.qty, 0);
    const rawItems: OrderLineItemRow[] = o.line_items.map((li) => {
      const custom = !isStockLineItem(li);
      const variant = li.variant_id ? variantById.get(li.variant_id) : undefined;
      const product = variant ? productById.get(variant.product_id) : undefined;
      const imageUrl = custom ? null : (product?.image_url ?? null);
      const imageMissingReason = custom
        ? null
        : imageUrl
          ? null
          : !variant
            ? "no_variant"
            : !product
              ? "no_product"
              : "no_image";
      const variantId = li.variant_id;
      const onHand = !variantId
        ? 0
        : lagerCfg.batches_enabled
          ? (shippableByVariant?.get(variantId) ?? 0)
          : (variant?.on_hand_total ?? 0);
      const reserved = custom ? 0 : (variant?.reserved_total ?? 0);
      return {
        id: li.id,
        title: product?.title ?? li.title,
        variantTitle: variant?.title ?? "",
        sku: li.sku ?? variant?.sku ?? null,
        qty: li.qty,
        imageUrl,
        imageMissingReason,
        variantId: li.variant_id,
        custom,
        onHand,
        reserved,
        available: onHand - reserved,
        charges: chargesByLine?.get(li.id) ?? [],
        mergedFromIds: [li.id],
        bundle: li.bundle
          ? {
              groupId: li.bundle.group_id,
              title: li.bundle.title,
              quantity: li.bundle.quantity,
              variantSku: li.bundle.variant_sku,
            }
          : null,
      };
    });
    return {
      id: o.id,
      name: o.name,
      status: o.internal_status,
      financialStatus: o.shopify_financial_status ?? null,
      fulfillmentStatus: o.shopify_fulfillment_status ?? null,
      tags: o.tags,
      stopReason: o.stop_reason ?? null,
      createdIso: tsToIso(o.created_at_shopify),
      itemCount,
      lineItems: mergeDuplicateLineItems(rawItems),
      customerNote: o.customer_note ?? null,
    };
  });
}
