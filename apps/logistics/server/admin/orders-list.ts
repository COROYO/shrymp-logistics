import "server-only";
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
    const key = `${li.bundle?.groupId ?? "_"}|${li.sku ?? "_"}|${li.title}`;
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

export async function loadOrderRows(
  filter: OrdersListFilter,
  shopId: string,
): Promise<OrderRow[]> {
  const db = adminDb();
  const baseCol = ordersForShop(db, shopId);
  const q =
    filter === "ALL"
      ? baseCol.orderBy("created_at_shopify", "desc").limit(100)
      : baseCol
          .where("internal_status", "==", filter)
          .orderBy("created_at_shopify", "desc")
          .limit(100);

  const snap = await q.get();
  const orders = snap.docs.map((d) => d.data() as Order);
  if (orders.length === 0) return [];

  const { loadReservedByVariant } = await import("@/server/inventory/reserved");
  const { loadShippableQtyByVariant } = await import(
    "@/server/inventory/shippable-stock"
  );
  const reservedByVariant = await loadReservedByVariant(shopId);

  const variantIds = Array.from(
    new Set(orders.flatMap((o) => o.line_items.map((li) => li.variant_id))),
  ).filter(Boolean);

  const [variantById, shippableByVariant] = await (async () => {
    const byId = new Map<string, Variant>();
    if (variantIds.length === 0) {
      return [byId, new Map<string, number>()] as const;
    }
    const variantRefs = variantIds.map((id) =>
      db.collection(Collections.Variants).doc(id),
    );
    const [variantSnaps, shippable] = await Promise.all([
      db.getAll(...variantRefs),
      loadShippableQtyByVariant(variantIds, shopId),
    ]);
    for (const v of variantSnaps) {
      if (v.exists) byId.set(v.id, v.data() as Variant);
    }
    return [byId, shippable] as const;
  })();

  const productIds = Array.from(
    new Set(
      Array.from(variantById.values())
        .map((v) => v.product_id)
        .filter(Boolean),
    ),
  );
  const productById = new Map<string, Product>();
  if (productIds.length > 0) {
    const productRefs = productIds.map((id) =>
      db.collection(Collections.Products).doc(id),
    );
    const productSnaps = await db.getAll(...productRefs);
    for (const p of productSnaps) {
      if (p.exists) productById.set(p.id, p.data() as Product);
    }
  }

  const chargesByOrderLine = new Map<string, Map<string, ChargeRow[]>>();
  {
    const allocSnaps = await Promise.all(
      chunkIds(orders.map((o) => o.id), 30).map((c) =>
        db.collection(Collections.Allocations).where("order_id", "in", c).get(),
      ),
    );
    const allocs = allocSnaps
      .flatMap((s) => s.docs.map((d) => d.data() as Allocation))
      .filter((a) => !a.released);
    if (allocs.length > 0) {
      const batchIds = Array.from(new Set(allocs.map((a) => a.batch_id)));
      const batchById = new Map<string, Batch>();
      const batchSnaps = await db.getAll(
        ...batchIds.map((id) => db.collection(Collections.Batches).doc(id)),
      );
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
  }

  return orders.map<OrderRow>((o) => {
    const chargesByLine = chargesByOrderLine.get(o.id);
    const itemCount = o.line_items.reduce((sum, li) => sum + li.qty, 0);
    const rawItems: OrderLineItemRow[] = o.line_items.map((li) => {
      const variant = variantById.get(li.variant_id);
      const product = variant ? productById.get(variant.product_id) : undefined;
      const imageUrl = product?.image_url ?? null;
      const imageMissingReason = imageUrl
        ? null
        : !variant
          ? "no_variant"
          : !product
            ? "no_product"
            : "no_image";
      return {
        id: li.id,
        title: product?.title ?? li.title,
        variantTitle: variant?.title ?? "",
        sku: li.sku ?? variant?.sku ?? null,
        qty: li.qty,
        imageUrl,
        imageMissingReason,
        variantId: li.variant_id,
        onHand: shippableByVariant.get(li.variant_id) ?? 0,
        reserved: reservedByVariant.get(li.variant_id) ?? 0,
        available:
          (shippableByVariant.get(li.variant_id) ?? 0) -
          (reservedByVariant.get(li.variant_id) ?? 0),
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
      tags: o.tags,
      stopReason: o.stop_reason ?? null,
      createdIso: tsToIso(o.created_at_shopify),
      itemCount,
      lineItems: mergeDuplicateLineItems(rawItems),
      customerNote: o.customer_note ?? null,
    };
  });
}
