import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type InventoryMovement,
  type Order,
} from "@/server/firestore/schema";

export const dynamic = "force-dynamic";

function tsToIso(t: unknown): string | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  return null;
}

async function load(orderId: string) {
  const db = adminDb();
  const orderSnap = await db
    .collection(Collections.Orders)
    .doc(orderId)
    .get();
  if (!orderSnap.exists) return null;
  const order = orderSnap.data() as Order;

  const [allocSnap, movSnap] = await Promise.all([
    db
      .collection(Collections.Allocations)
      .where("order_id", "==", orderId)
      .get(),
    db
      .collection(Collections.InventoryMovements)
      .where("ref.id", "==", orderId)
      .limit(50)
      .get(),
  ]);

  const allocs = allocSnap.docs.map((d) => d.data() as Allocation);
  const movs = movSnap.docs.map((d) => d.data() as InventoryMovement);

  // Load batches mentioned in allocations
  const batchIds = Array.from(new Set(allocs.map((a) => a.batch_id)));
  const batchSnaps = await Promise.all(
    batchIds.map((id) => db.collection(Collections.Batches).doc(id).get()),
  );
  const batchById = new Map<string, Batch>();
  for (const b of batchSnaps) {
    if (b.exists) batchById.set(b.id, b.data() as Batch);
  }

  return { order, allocs, movs, batchById };
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { order, allocs, movs, batchById } = data;
  const createdIso = tsToIso(order.created_at_shopify);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/orders"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">
            {order.name}
          </h1>
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
            {order.internal_status}
          </span>
          {order.tags.map((t) => (
            <span
              key={t}
              className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700"
            >
              {t}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Order-ID {order.id} · Shopify-GID {order.shopify_gid} · Erstellt{" "}
          {createdIso ? new Date(createdIso).toLocaleString("de-DE") : "—"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-xs uppercase tracking-wide text-zinc-500">
            Lieferadresse
          </h2>
          <address className="mt-2 not-italic text-sm leading-relaxed">
            {order.shipping_address?.first_name}{" "}
            {order.shipping_address?.last_name}
            {order.shipping_address?.company ? (
              <>
                <br />
                {order.shipping_address.company}
              </>
            ) : null}
            <br />
            {order.shipping_address?.address1}
            {order.shipping_address?.address2 ? (
              <>
                <br />
                {order.shipping_address.address2}
              </>
            ) : null}
            <br />
            {order.shipping_address?.zip} {order.shipping_address?.city}
            <br />
            {order.shipping_address?.country}
          </address>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-xs uppercase tracking-wide text-zinc-500">
            Shopify-Status
          </h2>
          <dl className="mt-2 text-sm space-y-1">
            <DefRow label="Financial">
              {order.shopify_financial_status ?? "—"}
            </DefRow>
            <DefRow label="Fulfillment">
              {order.shopify_fulfillment_status ?? "—"}
            </DefRow>
            <DefRow label="Stop-Grund">{order.stop_reason ?? "—"}</DefRow>
            <DefRow label="Allocation-Run">
              {order.allocation_run_id ? (
                <span className="font-mono text-xs">{order.allocation_run_id}</span>
              ) : (
                "—"
              )}
            </DefRow>
          </dl>
        </section>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-6 py-3">
          <h2 className="text-sm font-semibold">
            Line Items + Allocations ({allocs.length} Reservierungen)
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left">
            <tr>
              <th className="px-6 py-2 font-medium">Position</th>
              <th className="px-6 py-2 font-medium">SKU</th>
              <th className="px-6 py-2 font-medium text-right">Soll</th>
              <th className="px-6 py-2 font-medium">Allokationen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {order.line_items.map((li) => {
              const liAllocs = allocs.filter((a) => a.line_item_id === li.id);
              return (
                <tr key={li.id} className="align-top">
                  <td className="px-6 py-2">
                    <div className="font-medium">{li.title}</div>
                    <div className="text-xs text-zinc-500">
                      Variant {li.variant_id}
                    </div>
                  </td>
                  <td className="px-6 py-2 font-mono text-xs">
                    {li.sku ?? "—"}
                  </td>
                  <td className="px-6 py-2 text-right">{li.qty}</td>
                  <td className="px-6 py-2 text-xs space-y-1">
                    {liAllocs.length === 0 ? (
                      <span className="text-amber-700">— keine —</span>
                    ) : (
                      liAllocs.map((a) => {
                        const b = batchById.get(a.batch_id);
                        const consumedIso = tsToIso(a.consumed_at);
                        return (
                          <div key={a.id} className="flex flex-wrap gap-2">
                            <span className="font-mono bg-zinc-100 px-1.5 py-0.5 rounded">
                              {b?.charge_number ?? a.batch_id.slice(0, 6)}
                            </span>
                            <span className="font-semibold">{a.qty}x</span>
                            {consumedIso ? (
                              <span className="text-emerald-700">
                                ✓ konsumiert {new Date(consumedIso).toLocaleString("de-DE")}
                              </span>
                            ) : (
                              <span className="text-zinc-500">reserviert</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-6 py-3">
          <h2 className="text-sm font-semibold">
            Inventory-Movements ({movs.length})
          </h2>
        </div>
        {movs.length === 0 ? (
          <p className="px-6 py-3 text-sm text-zinc-500">Keine Movements.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-6 py-2 font-medium">Wann</th>
                <th className="px-6 py-2 font-medium">Typ</th>
                <th className="px-6 py-2 font-medium text-right">Qty</th>
                <th className="px-6 py-2 font-medium">Charge</th>
                <th className="px-6 py-2 font-medium">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {movs
                .sort((a, b) => {
                  const ia = tsToIso(a.created_at) ?? "";
                  const ib = tsToIso(b.created_at) ?? "";
                  return ib.localeCompare(ia);
                })
                .map((m) => (
                  <tr key={m.id}>
                    <td className="px-6 py-2 text-zinc-500 text-xs">
                      {(() => {
                        const iso = tsToIso(m.created_at);
                        return iso
                          ? new Date(iso).toLocaleString("de-DE")
                          : "—";
                      })()}
                    </td>
                    <td className="px-6 py-2">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold">
                        {m.type}
                      </span>
                    </td>
                    <td
                      className={`px-6 py-2 text-right font-mono ${
                        m.qty < 0 ? "text-red-700" : "text-emerald-700"
                      }`}
                    >
                      {m.qty > 0 ? "+" : ""}
                      {m.qty}
                    </td>
                    <td className="px-6 py-2 font-mono text-xs">
                      {m.batch_id
                        ? batchById.get(m.batch_id)?.charge_number ?? m.batch_id.slice(0, 8)
                        : "—"}
                    </td>
                    <td className="px-6 py-2 text-xs">{m.user_id ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function DefRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
