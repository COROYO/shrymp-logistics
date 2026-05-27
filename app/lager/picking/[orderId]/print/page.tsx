import { notFound } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import { PrintTrigger } from "./print-trigger";

export const dynamic = "force-dynamic";

type AllocLine = {
  lineItemId: string;
  chargeNumber: string;
  expiryDateIso: string | null;
  qty: number;
};

async function load(orderId: string) {
  const db = adminDb();
  const orderSnap = await db.collection(Collections.Orders).doc(orderId).get();
  if (!orderSnap.exists) return null;
  const order = orderSnap.data() as Order;

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
    } else if (
      exp &&
      typeof (exp as { seconds?: number }).seconds === "number"
    ) {
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
  for (const list of allocsByLi.values()) {
    list.sort((a, b) => {
      if (a.expiryDateIso === b.expiryDateIso) {
        return a.chargeNumber.localeCompare(b.chargeNumber);
      }
      if (!a.expiryDateIso) return 1;
      if (!b.expiryDateIso) return -1;
      return a.expiryDateIso.localeCompare(b.expiryDateIso);
    });
  }

  return { order, allocsByLi };
}

export default async function PrintPicklist({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const data = await load(orderId);
  if (!data) notFound();
  const { order, allocsByLi } = data;
  const isExpress = order.tags.includes("EXPRESS_DHL");
  const now = new Date().toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="bg-white text-black p-8 print:p-4">
      <PrintTrigger />

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 15mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <header className="flex items-baseline justify-between border-b-2 border-black pb-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-mono">
            {order.name}
          </h1>
          <p className="text-xs text-zinc-700 mt-1">
            Picklist · {now}{" "}
            {isExpress ? (
              <span className="ml-2 bg-black text-white px-1.5 py-0.5 text-xs">
                EXPRESS
              </span>
            ) : null}
          </p>
        </div>
        <div className="text-right text-xs text-zinc-700">
          <p>Monolith Caviar</p>
          <p>FEFO-Picklist</p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-zinc-600 font-semibold">
            Lieferadresse
          </h2>
          <address className="not-italic text-sm leading-snug mt-1">
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
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wide text-zinc-600 font-semibold">
            Tags
          </h2>
          <div className="mt-1 text-sm">{order.tags.join(", ") || "—"}</div>
        </div>
      </section>

      <table className="mt-8 w-full text-sm border-collapse">
        <thead className="border-b-2 border-black">
          <tr className="text-left">
            <th className="py-2 font-semibold">Produkt</th>
            <th className="py-2 font-semibold">SKU</th>
            <th className="py-2 px-4 font-semibold text-right">Menge</th>
            <th className="py-2 font-semibold">Charge · MHD</th>
            <th className="py-2 w-8 font-semibold">✓</th>
          </tr>
        </thead>
        <tbody>
          {order.line_items.map((li) => {
            const allocs = allocsByLi.get(li.id) ?? [];
            return (
              <tr key={li.id} className="border-b border-zinc-300 align-top">
                <td className="py-3 pr-4">
                  <div className="font-semibold">{li.title}</div>
                </td>
                <td className="py-3 pr-4 font-mono text-xs">{li.sku ?? "—"}</td>
                <td className="py-3 pr-4 text-right text-lg font-bold">
                  {li.qty}
                </td>
                <td className="py-3 pr-4">
                  {allocs.length === 0 ? (
                    <span className="text-xs italic">— keine Allokation —</span>
                  ) : (
                    <div className="space-y-0.5 space-x-1">
                      {allocs.map((a, idx) => (
                        <div key={idx} className="font-mono text-xs">
                          <span className="font-bold">{a.chargeNumber}</span>
                          {" · "}
                          MHD {a.expiryDateIso ?? "—"}
                          {" · "}
                          <span className="font-bold">{a.qty} Stk</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-3 text-center">
                  <span className="inline-block border-2 border-black h-5 w-5"></span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <footer className="mt-12 text-xs text-zinc-600 border-t border-zinc-300 pt-2">
        Order-ID: {order.id} · Status: {order.internal_status}
      </footer>
    </div>
  );
}
