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

      <dl className="grid gap-3 sm:grid-cols-4 text-sm">
        <Stat label="Zeilen" value={rows.length} />
        <Stat label="Offen (reserviert)" value={openCount} />
        <Stat label="Konsumiert" value={consumedCount} />
        <Stat label="Orders / Chargen" value={`${orderCount} / ${batchCount}`} />
      </dl>

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
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="card p-5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd className="mt-1.5 text-2xl font-bold tabular-nums text-brand-navy">
        {value}
      </dd>
    </div>
  );
}
