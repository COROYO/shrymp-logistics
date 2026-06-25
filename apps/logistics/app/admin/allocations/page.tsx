import Link from "next/link";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import {
  AllocationsTable,
  type AllocationTableRow,
} from "./allocations-table";

export const dynamic = "force-dynamic";

type StatusFilter = "ALL" | "open" | "consumed";
const STATUS_FILTERS: StatusFilter[] = ["ALL", "open", "consumed"];

function tsToIso(t: unknown): string | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  return null;
}

async function loadAllocationRows(opts: {
  status: StatusFilter;
  orderId?: string;
  batchId?: string;
}): Promise<AllocationTableRow[]> {
  const db = adminDb();

  let allocSnap;
  if (opts.batchId) {
    allocSnap = await db
      .collection(Collections.Allocations)
      .where("batch_id", "==", opts.batchId)
      .get();
  } else if (opts.orderId) {
    allocSnap = await db
      .collection(Collections.Allocations)
      .where("order_id", "==", opts.orderId)
      .get();
  } else {
    allocSnap = await db
      .collection(Collections.Allocations)
      .orderBy("created_at", "desc")
      .limit(500)
      .get();
  }

  let allocs = allocSnap.docs.map((d) => d.data() as Allocation);

  if (opts.status === "open") {
    allocs = allocs.filter((a) => !a.consumed_at);
  } else if (opts.status === "consumed") {
    allocs = allocs.filter((a) => a.consumed_at);
  }

  if (allocs.length === 0) return [];

  const orderIds = Array.from(new Set(allocs.map((a) => a.order_id)));
  const batchIds = Array.from(new Set(allocs.map((a) => a.batch_id)));
  const variantIds = Array.from(new Set(allocs.map((a) => a.variant_id)));

  const [orderSnaps, batchSnaps, variantSnaps] = await Promise.all([
    db.getAll(...orderIds.map((id) => db.collection(Collections.Orders).doc(id))),
    db.getAll(...batchIds.map((id) => db.collection(Collections.Batches).doc(id))),
    db.getAll(
      ...variantIds.map((id) => db.collection(Collections.Variants).doc(id)),
    ),
  ]);

  const orderById = new Map<string, Order>();
  for (const o of orderSnaps) {
    if (o.exists) orderById.set(o.id, o.data() as Order);
  }

  const batchById = new Map<string, Batch>();
  for (const b of batchSnaps) {
    if (b.exists) batchById.set(b.id, b.data() as Batch);
  }

  const variantById = new Map<string, Variant>();
  for (const v of variantSnaps) {
    if (v.exists) variantById.set(v.id, v.data() as Variant);
  }

  // Product lookup for the "Produkt" column — only batch the products we
  // actually need rather than scanning the whole collection.
  const productIds = Array.from(
    new Set(
      [...variantById.values()]
        .map((v) => v.product_id)
        .filter((p): p is string => !!p),
    ),
  );
  const productSnaps = productIds.length
    ? await db.getAll(
        ...productIds.map((id) => db.collection(Collections.Products).doc(id)),
      )
    : [];
  const productById = new Map<string, Product>();
  for (const p of productSnaps) {
    if (p.exists) productById.set(p.id, p.data() as Product);
  }

  const rows = allocs.map<AllocationTableRow>((a) => {
    const order = orderById.get(a.order_id);
    const batch = batchById.get(a.batch_id);
    const variant = variantById.get(a.variant_id);
    const product = variant ? productById.get(variant.product_id) : undefined;
    const lineItem = order?.line_items.find((li) => li.id === a.line_item_id);

    return {
      id: a.id,
      orderId: a.order_id,
      orderName: order?.name ?? a.order_id,
      orderStatus: order?.internal_status ?? "NEW",
      productTitle: product?.title ?? lineItem?.title ?? "—",
      variantTitle: variant?.title ?? null,
      chargeNumber: batch?.charge_number ?? a.batch_id.slice(0, 8),
      batchId: a.batch_id,
      expiryDateIso: tsToIso(batch?.expiry_date ?? null),
      variantId: a.variant_id,
      sku: lineItem?.sku ?? variant?.sku ?? null,
      qty: a.qty,
      reservedIso: tsToIso(a.created_at),
      consumedIso: tsToIso(a.consumed_at ?? null),
      released: !!a.released,
      releaseReason: a.release_reason ?? null,
      runId: a.run_id,
    };
  });

  return rows;
}

function buildFilterHref(status: StatusFilter): string {
  return status === "ALL" ? "/admin/allocations" : `/admin/allocations?status=${status}`;
}

export type ReservedSummaryRow = {
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  qty: number;
  orderCount: number;
};

/**
 * Reserved-goods overview: per variant, how much is committed to open
 * SHIP/PICKING orders. Source of truth = order demand (see
 * server/inventory/reserved.ts), independent of charge-allocation docs.
 */
async function loadReservedSummary(): Promise<ReservedSummaryRow[]> {
  const db = adminDb();
  const { loadReservedDetailByVariant } = await import(
    "@/server/inventory/reserved"
  );
  const detail = await loadReservedDetailByVariant();
  if (detail.size === 0) return [];

  const variantIds = [...detail.keys()];
  const variantSnaps = await db.getAll(
    ...variantIds.map((id) => db.collection(Collections.Variants).doc(id)),
  );
  const variantById = new Map<string, Variant>();
  for (const v of variantSnaps) {
    if (v.exists) variantById.set(v.id, v.data() as Variant);
  }

  const productIds = Array.from(
    new Set(
      [...variantById.values()]
        .map((v) => v.product_id)
        .filter((p): p is string => !!p),
    ),
  );
  const productById = new Map<string, Product>();
  if (productIds.length > 0) {
    const productSnaps = await db.getAll(
      ...productIds.map((id) => db.collection(Collections.Products).doc(id)),
    );
    for (const p of productSnaps) {
      if (p.exists) productById.set(p.id, p.data() as Product);
    }
  }

  const out: ReservedSummaryRow[] = variantIds.map((vid) => {
    const d = detail.get(vid)!;
    const variant = variantById.get(vid);
    const product = variant ? productById.get(variant.product_id) : undefined;
    return {
      variantId: vid,
      productTitle: product?.title ?? variant?.title ?? "—",
      variantTitle: variant?.title ?? null,
      sku: variant?.sku ?? null,
      qty: d.qty,
      orderCount: d.orderIds.size,
    };
  });
  out.sort((a, b) => b.qty - a.qty);
  return out;
}

export default async function AllocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; order_id?: string; batch_id?: string }>;
}) {
  const { status, order_id, batch_id } = await searchParams;
  const filter: StatusFilter = (STATUS_FILTERS as string[]).includes(status ?? "")
    ? (status as StatusFilter)
    : "ALL";

  const rows = await loadAllocationRows({
    status: filter,
    orderId: order_id,
    batchId: batch_id,
  });

  const openCount = rows.filter((r) => !r.consumedIso).length;
  const consumedCount = rows.filter((r) => r.consumedIso).length;
  const orderCount = new Set(rows.map((r) => r.orderId)).size;
  const batchCount = new Set(rows.map((r) => r.batchId)).size;

  // Reserved goods — the authoritative figure, computed from SHIP/PICKING
  // order demand (NOT from charge-allocation docs, which only exist after a
  // slip is printed). This is what's actually committed and unavailable to
  // new orders.
  const reservedSummary = await loadReservedSummary();
  const reservedTotal = reservedSummary.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Zuordnung</p>
        <h1 className="h-display mt-1 text-3xl">Charge ↔ Order</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
          Welche Charge ist welcher Bestellung zugeordnet? Jede Zeile ist eine
          Allokation aus dem Allocation-Run — reserviert bis zum Packing
          (Konsum).
        </p>
        {(order_id || batch_id) && (
          <p className="mt-2 text-xs text-brand-navy/60">
            Gefiltert
            {order_id ? (
              <>
                {" "}
                nach Order{" "}
                <span className="font-mono">{order_id}</span>
              </>
            ) : null}
            {batch_id ? (
              <>
                {" "}
                nach Charge{" "}
                <span className="font-mono">{batch_id.slice(0, 8)}…</span>
              </>
            ) : null}
            {" · "}
            <Link
              href="/admin/allocations"
              className="font-semibold text-brand-burgundy underline-offset-2 hover:underline"
            >
              Filter zurücksetzen
            </Link>
          </p>
        )}
      </div>

      <dl className="grid gap-3 sm:grid-cols-5 text-sm">
        <Stat label="Zeilen" value={rows.length} />
        <Stat label="Reserviert (Stück)" value={reservedTotal} highlight />
        <Stat label="Offen (Zeilen)" value={openCount} />
        <Stat label="Konsumiert" value={consumedCount} />
        <Stat label="Orders / Chargen" value={`${orderCount} / ${batchCount}`} />
      </dl>

      {reservedSummary.length > 0 ? (
        <section className="card overflow-hidden">
          <div className="border-b border-zinc-200 px-6 py-4">
            <p className="eyebrow">Reservierte Ware</p>
            <h2 className="mt-1 text-sm font-semibold text-brand-navy">
              {reservedTotal} Stück in {reservedSummary.length} Variante
              {reservedSummary.length === 1 ? "" : "n"} gebunden
            </h2>
            <p className="mt-1 text-xs text-brand-navy/60">
              Bestand, der offenen SHIP-/PICKING-Orders zugeordnet und damit für
              neue Bestellungen nicht verfügbar ist.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-brand">
              <thead>
                <tr>
                  <th>Produkt</th>
                  <th>SKU</th>
                  <th className="text-right">Reserviert</th>
                  <th className="text-right">Orders</th>
                </tr>
              </thead>
              <tbody>
                {reservedSummary.map((r) => (
                  <tr key={r.variantId}>
                    <td className="text-xs text-brand-navy/80">
                      <div className="font-semibold">{r.productTitle}</div>
                      {r.variantTitle ? (
                        <div className="text-brand-navy/60">
                          {r.variantTitle}
                        </div>
                      ) : null}
                    </td>
                    <td className="font-mono text-xs text-brand-navy/70">
                      {r.sku ?? "—"}
                    </td>
                    <td className="text-right text-base font-bold text-brand-burgundy">
                      {r.qty}
                    </td>
                    <td className="text-right text-xs text-brand-navy/70">
                      {r.orderCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <nav className="flex flex-wrap items-center gap-2 text-sm">
        {STATUS_FILTERS.map((f) => {
          const isActive = filter === f;
          const href =
            f === "ALL"
              ? buildFilterHref("ALL") +
                (order_id ? `?order_id=${order_id}` : batch_id ? `?batch_id=${batch_id}` : "")
              : buildFilterHref(f) +
                (order_id ? `&order_id=${order_id}` : batch_id ? `&batch_id=${batch_id}` : "");
          return (
            <Link
              key={f}
              href={href}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
                isActive
                  ? "bg-brand-navy text-white"
                  : "border border-zinc-200 bg-white text-brand-navy/70 hover:border-brand-navy hover:text-brand-navy"
              }`}
            >
              {f === "ALL" ? "Alle" : f === "open" ? "Offen" : "Konsumiert"}
            </Link>
          );
        })}
      </nav>

      <AllocationsTable rows={rows} />
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className={`card p-5 ${highlight ? "ring-1 ring-brand-burgundy/30" : ""}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd
        className={`mt-1.5 text-2xl font-bold tabular-nums ${
          highlight ? "text-brand-burgundy" : "text-brand-navy"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
