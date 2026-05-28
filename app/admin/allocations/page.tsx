import Link from "next/link";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
  type Variant,
} from "@/server/firestore/schema";

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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE");
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE");
}

type AllocationRow = {
  id: string;
  orderId: string;
  orderName: string;
  orderStatus: Order["internal_status"];
  chargeNumber: string;
  batchId: string;
  expiryDateIso: string | null;
  variantId: string;
  sku: string | null;
  qty: number;
  reservedIso: string | null;
  consumedIso: string | null;
  released: boolean;
  releaseReason: string | null;
  runId: string;
};

async function loadAllocationRows(opts: {
  status: StatusFilter;
  orderId?: string;
  batchId?: string;
}): Promise<AllocationRow[]> {
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

  const rows = allocs.map<AllocationRow>((a) => {
    const order = orderById.get(a.order_id);
    const batch = batchById.get(a.batch_id);
    const variant = variantById.get(a.variant_id);
    const lineItem = order?.line_items.find((li) => li.id === a.line_item_id);

    return {
      id: a.id,
      orderId: a.order_id,
      orderName: order?.name ?? a.order_id,
      orderStatus: order?.internal_status ?? "NEW",
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

  rows.sort((a, b) => {
    const ia = a.reservedIso ?? "";
    const ib = b.reservedIso ?? "";
    return ib.localeCompare(ia);
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

      <section className="card overflow-hidden">
        <div className="border-b border-zinc-200 px-6 py-4">
          <p className="eyebrow">Allokationen</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {rows.length} Zuordnung{rows.length === 1 ? "" : "en"}
          </h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-brand-navy/60">
            Keine Allokationen für diesen Filter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-brand">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Charge</th>
                  <th>MHD</th>
                  <th>SKU</th>
                  <th className="text-right">Menge</th>
                  <th>Status</th>
                  <th>Reserviert</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        href={`/admin/orders/${r.orderId}`}
                        className="font-mono font-semibold text-brand-navy transition hover:text-brand-burgundy"
                      >
                        {r.orderName}
                      </Link>
                      <div className="mt-0.5">
                        <span className="chip chip-soft">{r.orderStatus}</span>
                      </div>
                    </td>
                    <td>
                      <Link
                        href={`/admin/allocations?batch_id=${r.batchId}`}
                        className="rounded-md bg-brand-navy px-2 py-0.5 font-mono text-xs font-semibold text-white transition hover:bg-brand-burgundy"
                      >
                        {r.chargeNumber}
                      </Link>
                    </td>
                    <td className="text-xs text-brand-navy/70">
                      {formatExpiry(r.expiryDateIso)}
                    </td>
                    <td className="font-mono text-xs text-brand-navy/70">
                      {r.sku ?? "—"}
                    </td>
                    <td className="text-right text-base font-bold text-brand-navy">
                      {r.qty}
                    </td>
                    <td>
                      {r.consumedIso ? (
                        r.released ? (
                          <span
                            className="text-xs text-brand-burgundy"
                            title={r.releaseReason ?? undefined}
                          >
                            ↩ released
                            <div className="text-[10px] text-brand-navy/50">
                              {formatDate(r.consumedIso)}
                            </div>
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-700">
                            ✓ {formatDate(r.consumedIso)}
                          </span>
                        )
                      ) : (
                        <span className="chip chip-amber">reserviert</span>
                      )}
                    </td>
                    <td className="text-xs text-brand-navy/60">
                      {formatDate(r.reservedIso)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
