import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  ConfigDocs,
  type Allocation,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import { ConfirmPackingForm } from "./confirm-packing-form";
import { DhlLabelButtons } from "./dhl-label-buttons";

export const dynamic = "force-dynamic";

type AllocLine = {
  lineItemId: string;
  chargeNumber: string;
  expiryDateIso: string | null;
  qty: number;
};

async function loadOrderForPacking(orderId: string) {
  const db = adminDb();
  const [orderSnap, metaSnap] = await Promise.all([
    db.collection(Collections.Orders).doc(orderId).get(),
    db.collection(Collections.Config).doc(ConfigDocs.ShopifyMeta).get(),
  ]);
  if (!orderSnap.exists) return null;
  const order = orderSnap.data() as Order;
  const shopDomain =
    (metaSnap.data()?.shop_domain as string | undefined) ??
    process.env.SHOPIFY_SHOP_DOMAIN ??
    "";

  const allocSnap = await db
    .collection(Collections.Allocations)
    .where("order_id", "==", orderId)
    .get();
  const allocs = allocSnap.docs.map((d) => d.data() as Allocation);
  const batchIds = Array.from(new Set(allocs.map((a) => a.batch_id)));
  const batchSnaps = await Promise.all(
    batchIds.map((b) => db.collection(Collections.Batches).doc(b).get()),
  );
  const batchById = new Map<string, Batch>();
  for (const b of batchSnaps) {
    if (b.exists) batchById.set(b.id, b.data() as Batch);
  }

  const allocsByLi = new Map<string, AllocLine[]>();
  for (const a of allocs) {
    if (a.consumed_at) continue;
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
    const entry: AllocLine = {
      lineItemId: a.line_item_id,
      chargeNumber: b.charge_number,
      expiryDateIso: iso,
      qty: a.qty,
    };
    const list = allocsByLi.get(a.line_item_id);
    if (list) list.push(entry);
    else allocsByLi.set(a.line_item_id, [entry]);
  }

  return { order, allocsByLi, shopDomain };
}

export default async function PackingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const data = await loadOrderForPacking(orderId);
  if (!data) notFound();
  const { order, allocsByLi, shopDomain } = data;

  const isPacking = order.internal_status === "PICKING";
  const isPacked = order.internal_status === "PACKED";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/lager/picking/${order.id}`}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Zurück zur Picklist
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">
            {order.name}
          </h1>
          <span
            className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
              isPacked
                ? "bg-sky-100 text-sky-800"
                : isPacking
                  ? "bg-violet-100 text-violet-800"
                  : "bg-zinc-100 text-zinc-700"
            }`}
          >
            {order.internal_status}
          </span>
        </div>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">
          Lieferadresse
        </h2>
        <address className="mt-2 not-italic text-base leading-relaxed">
          <strong>
            {order.shipping_address?.first_name}{" "}
            {order.shipping_address?.last_name}
          </strong>
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
        <div className="border-b border-zinc-200 px-6 py-3">
          <h2 className="text-sm font-semibold">Inhalt</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left">
            <tr>
              <th className="px-6 py-2 font-medium">Produkt</th>
              <th className="px-6 py-2 font-medium text-right">Menge</th>
              <th className="px-6 py-2 font-medium">Chargen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {order.line_items.map((li) => {
              const allocs = allocsByLi.get(li.id) ?? [];
              return (
                <tr key={li.id}>
                  <td className="px-6 py-2">
                    <div className="font-medium">{li.title}</div>
                    {li.sku ? (
                      <div className="text-xs text-zinc-500 font-mono">
                        SKU {li.sku}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-6 py-2 text-right font-semibold">
                    {li.qty}
                  </td>
                  <td className="px-6 py-2 text-xs">
                    {allocs.map((a, idx) => (
                      <span
                        key={idx}
                        className="mr-2 inline-block rounded bg-zinc-100 px-1.5 py-0.5 font-mono"
                      >
                        {a.chargeNumber} · {a.qty}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Versandetikett</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Öffnet das externe DHL-Tool in einem neuen Tab. Etikett dort drucken,
          anschließend hier &quot;Verpackt + versendet&quot; klicken.
        </p>
        <div className="mt-4">
          <DhlLabelButtons
            orderId={order.id}
            shopDomain={shopDomain}
            countryCode={order.shipping_address?.country_code ?? null}
          />
        </div>
      </section>

      <div className="flex gap-3">
        <Link
          href={`/lager/picking/${order.id}/print`}
          target="_blank"
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
        >
          Picklist nochmal drucken
        </Link>
      </div>

      {isPacking ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold">Verpackt + versendet</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Bucht den Bestand atomar ab, meldet Fulfillment und Inventory an
            Shopify zurück und schließt die Order.
          </p>
          <div className="mt-4">
            <ConfirmPackingForm orderId={order.id} />
          </div>
        </section>
      ) : isPacked ? (
        <div className="rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Order ist gepackt und gebucht.
        </div>
      ) : (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Order ist in Status <strong>{order.internal_status}</strong>. Pack-Bestätigung nur aus PICKING-Status möglich.
        </div>
      )}
    </div>
  );
}
