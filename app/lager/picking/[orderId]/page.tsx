import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import { StartPickingButton, CancelPickingButton } from "./client-buttons";

export const dynamic = "force-dynamic";

type AllocationLine = {
  lineItemId: string;
  batchId: string;
  chargeNumber: string;
  expiryDateIso: string | null;
  qty: number;
};

type LineItemDisplay = {
  id: string;
  title: string;
  sku: string | null;
  qty: number;
  variantId: string;
  variantTitle: string;
  productTitle: string;
  allocations: AllocationLine[];
};

async function loadOrder(orderId: string) {
  const db = adminDb();
  const orderSnap = await db
    .collection(Collections.Orders)
    .doc(orderId)
    .get();
  if (!orderSnap.exists) return null;
  const order = orderSnap.data() as Order;

  const [allocSnap, variantSnaps] = await Promise.all([
    db
      .collection(Collections.Allocations)
      .where("order_id", "==", orderId)
      .get(),
    Promise.all(
      Array.from(new Set(order.line_items.map((li) => li.variant_id))).map(
        (vid) => db.collection(Collections.Variants).doc(vid).get(),
      ),
    ),
  ]);

  const variantById = new Map<
    string,
    { title: string; product_id: string }
  >();
  for (const v of variantSnaps) {
    if (!v.exists) continue;
    const d = v.data() ?? {};
    variantById.set(v.id, {
      title: (d.title as string | undefined) ?? "—",
      product_id: (d.product_id as string | undefined) ?? "",
    });
  }
  const productIds = Array.from(
    new Set(Array.from(variantById.values()).map((v) => v.product_id)),
  ).filter(Boolean);
  const productById = new Map<string, string>();
  const productSnapsLoaded = await Promise.all(
    productIds.map((pid) =>
      db.collection(Collections.Products).doc(pid).get(),
    ),
  );
  for (const p of productSnapsLoaded) {
    if (!p.exists) continue;
    productById.set(p.id, (p.data()?.title as string | undefined) ?? p.id);
  }

  // Load batches referenced in the allocations.
  const allocs = allocSnap.docs.map((d) => d.data() as Allocation);
  const batchIds = Array.from(new Set(allocs.map((a) => a.batch_id)));
  const batchSnaps = await Promise.all(
    batchIds.map((bid) =>
      db.collection(Collections.Batches).doc(bid).get(),
    ),
  );
  const batchById = new Map<string, Batch>();
  for (const b of batchSnaps) {
    if (!b.exists) continue;
    batchById.set(b.id, b.data() as Batch);
  }

  // Group allocations by line item id, FEFO sorted.
  const allocsByLineItem = new Map<string, AllocationLine[]>();
  for (const a of allocs) {
    if (a.consumed_at) continue; // only open allocations
    const b = batchById.get(a.batch_id);
    if (!b) continue;
    const exp = b.expiry_date as unknown as
      | { toDate?(): Date; seconds?: number }
      | undefined;
    let iso: string | null = null;
    if (exp && typeof (exp as { toDate?: unknown }).toDate === "function") {
      iso = (exp as { toDate(): Date }).toDate().toISOString().slice(0, 10);
    } else if (exp && typeof (exp as { seconds?: number }).seconds === "number") {
      iso = new Date((exp as { seconds: number }).seconds * 1000)
        .toISOString()
        .slice(0, 10);
    }
    const entry: AllocationLine = {
      lineItemId: a.line_item_id,
      batchId: a.batch_id,
      chargeNumber: b.charge_number,
      expiryDateIso: iso,
      qty: a.qty,
    };
    const list = allocsByLineItem.get(a.line_item_id);
    if (list) list.push(entry);
    else allocsByLineItem.set(a.line_item_id, [entry]);
  }
  for (const list of allocsByLineItem.values()) {
    list.sort((a, b) => {
      if (a.expiryDateIso === b.expiryDateIso) {
        return a.chargeNumber.localeCompare(b.chargeNumber);
      }
      if (!a.expiryDateIso) return 1;
      if (!b.expiryDateIso) return -1;
      return a.expiryDateIso.localeCompare(b.expiryDateIso);
    });
  }

  const lineItems: LineItemDisplay[] = order.line_items.map((li) => {
    const v = variantById.get(li.variant_id);
    const productTitle = v?.product_id
      ? (productById.get(v.product_id) ?? "—")
      : "—";
    return {
      id: li.id,
      title: li.title,
      sku: li.sku,
      qty: li.qty,
      variantId: li.variant_id,
      variantTitle: v?.title ?? "—",
      productTitle,
      allocations: allocsByLineItem.get(li.id) ?? [],
    };
  });

  return { order, lineItems };
}

export default async function PickingDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const result = await loadOrder(orderId);
  if (!result) notFound();
  const { order, lineItems } = result;

  const isPickable = order.internal_status === "SHIP";
  const isPicking = order.internal_status === "PICKING";
  const isExpress = order.tags.includes("EXPRESS_DHL");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/lager/picking"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Picking-Queue
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">
            {order.name}
          </h1>
          <span
            className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
              isPicking
                ? "bg-violet-100 text-violet-800"
                : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {order.internal_status}
          </span>
          {isExpress ? (
            <span className="rounded bg-purple-200 px-2 py-0.5 text-xs font-semibold text-purple-900">
              EXPRESS
            </span>
          ) : null}
        </div>
      </div>

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

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3">
          <h2 className="text-sm font-semibold">
            Picklist · FEFO ({lineItems.length} Position
            {lineItems.length === 1 ? "" : "en"})
          </h2>
          <Link
            href={`/lager/picking/${order.id}/print`}
            target="_blank"
            className="text-xs underline text-zinc-600 hover:text-zinc-900"
          >
            Drucken
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left">
            <tr>
              <th className="px-6 py-2 font-medium">Produkt</th>
              <th className="px-6 py-2 font-medium">SKU</th>
              <th className="px-6 py-2 font-medium text-right">Menge</th>
              <th className="px-6 py-2 font-medium">Charge / MHD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {lineItems.map((li) => (
              <tr key={li.id} className="align-top">
                <td className="px-6 py-3">
                  <div className="font-medium">{li.productTitle}</div>
                  <div className="text-xs text-zinc-500">{li.variantTitle}</div>
                </td>
                <td className="px-6 py-3 font-mono text-xs">{li.sku ?? "—"}</td>
                <td className="px-6 py-3 text-right text-base font-semibold">
                  {li.qty}
                </td>
                <td className="px-6 py-3">
                  {li.allocations.length === 0 ? (
                    <span className="text-amber-700 text-xs">
                      Noch keine Charge zugewiesen
                    </span>
                  ) : (
                    <div className="space-y-1">
                      {li.allocations.map((a, idx) => (
                        <div
                          key={`${a.batchId}-${idx}`}
                          className="flex items-baseline gap-2 text-xs"
                        >
                          <span className="font-mono font-semibold bg-zinc-100 px-1.5 py-0.5 rounded">
                            {a.chargeNumber}
                          </span>
                          <span className="text-zinc-600">
                            MHD {a.expiryDateIso ?? "—"}
                          </span>
                          <span className="text-zinc-900 font-semibold">
                            {a.qty} Stk
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {isPickable ? (
          <StartPickingButton orderId={order.id} />
        ) : null}
        {isPicking ? (
          <>
            <Link
              href={`/lager/packing/${order.id}`}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Picking abgeschlossen — weiter zum Packen →
            </Link>
            <CancelPickingButton orderId={order.id} />
          </>
        ) : null}
        {!isPickable && !isPicking ? (
          <span className="text-sm text-zinc-500">
            Order ist in Status <strong>{order.internal_status}</strong>, nicht
            picking-bar.
          </span>
        ) : null}
      </div>
    </div>
  );
}
