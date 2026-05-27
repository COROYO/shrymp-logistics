import Link from "next/link";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Order,
  type OrderInternalStatus,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import {
  OrdersTable,
  type OrderLineItemRow,
  type OrderRow,
} from "./orders-table";

export const dynamic = "force-dynamic";

type Filter = "ALL" | OrderInternalStatus;
const FILTERS: Filter[] = [
  "ALL",
  "NEW",
  "SHIP",
  "PICKING",
  "STOP",
  "PACKED",
  "CANCELLED",
];

function tsToIso(t: unknown): string {
  if (!t) return "";
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  return "";
}

async function loadOrderRows(filter: Filter): Promise<OrderRow[]> {
  const db = adminDb();

  const baseCol = db.collection(Collections.Orders);
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

  const variantIds = Array.from(
    new Set(
      orders.flatMap((o) => o.line_items.map((li) => li.variant_id)),
    ),
  ).filter(Boolean);

  const variantById = new Map<string, Variant>();
  if (variantIds.length > 0) {
    const variantRefs = variantIds.map((id) =>
      db.collection(Collections.Variants).doc(id),
    );
    const variantSnaps = await db.getAll(...variantRefs);
    for (const v of variantSnaps) {
      if (v.exists) variantById.set(v.id, v.data() as Variant);
    }
  }

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

  return orders.map<OrderRow>((o) => {
    const itemCount = o.line_items.reduce((sum, li) => sum + li.qty, 0);
    const rawItems: OrderLineItemRow[] = o.line_items.map((li) => {
      const variant = variantById.get(li.variant_id);
      const product = variant
        ? productById.get(variant.product_id)
        : undefined;
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
        onHand: variant?.on_hand_total ?? 0,
        reserved: variant?.reserved_total ?? 0,
        available: variant?.available ?? 0,
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

/**
 * Merge line items that share the same `(bundle.groupId, sku, title)`. Bundle
 * components are only merged within the same bundle so the parent → child
 * relationship stays intact, and standalone items only merge with other
 * standalone items.
 */
function mergeDuplicateLineItems(
  items: OrderLineItemRow[],
): OrderLineItemRow[] {
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
      mergedFromIds: [...existing.mergedFromIds, li.id],
    };
  }
  return merged;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: Filter = (FILTERS as string[]).includes(status ?? "")
    ? (status as Filter)
    : "ALL";

  const rows = await loadOrderRows(filter);

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Bestellungen</p>
        <h1 className="h-display mt-1 text-3xl">Orders</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
          Letzte 100 Bestellungen aus Shopify. Status wird vom Allocation-Run
          automatisch gesetzt. Klicke auf den Pfeil, um die Produkte und
          Bestände einer Order zu prüfen.
        </p>
      </div>

      <nav className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map((f) => {
          const isActive = filter === f;
          return (
            <Link
              key={f}
              href={f === "ALL" ? "/admin/orders" : `/admin/orders?status=${f}`}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
                isActive
                  ? "bg-brand-navy text-white"
                  : "border border-zinc-200 bg-white text-brand-navy/70 hover:border-brand-navy hover:text-brand-navy"
              }`}
            >
              {f}
            </Link>
          );
        })}
      </nav>

      <div className="card overflow-hidden">
        <OrdersTable orders={rows} />
      </div>
    </div>
  );
}
