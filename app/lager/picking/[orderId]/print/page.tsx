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
    <div className="bg-white p-8 text-brand-ink print:p-4">
      <PrintTrigger />

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 15mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <header className="flex items-end justify-between border-b-[3px] border-brand-burgundy pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-burgundy">
            Monolith Caviar · Picklist
          </p>
          <h1 className="mt-1 font-mono text-3xl font-bold tracking-tight text-brand-navy">
            {order.name}
          </h1>
          <p className="mt-1 text-xs text-brand-navy/70">
            FEFO · {now}
            {isExpress ? (
              <span className="ml-2 inline-block bg-brand-burgundy px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Express
              </span>
            ) : null}
          </p>
        </div>
        <div className="text-right text-xs text-brand-navy/70">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-navy">
            Ikrinka
          </p>
          <p>Premium Quality</p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
            Lieferadresse
          </h2>
          <address className="mt-1 not-italic text-sm leading-snug">
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
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
            Tags
          </h2>
          <div className="mt-1 text-sm">{order.tags.join(", ") || "—"}</div>
        </div>
      </section>

      <table className="mt-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-brand-navy bg-brand-navy text-left text-white">
            <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
              Produkt
            </th>
            <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
              SKU
            </th>
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.1em]">
              Menge
            </th>
            <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
              Charge · MHD
            </th>
            <th className="w-8 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em]">
              ✓
            </th>
          </tr>
        </thead>
        <tbody>
          {order.line_items.map((li) => {
            const allocs = allocsByLi.get(li.id) ?? [];
            return (
              <tr key={li.id} className="border-b border-zinc-300 align-top">
                <td className="px-3 py-3 pr-4">
                  <div className="font-semibold text-brand-navy">
                    {li.title}
                  </div>
                </td>
                <td className="px-3 py-3 pr-4 font-mono text-xs">
                  {li.sku ?? "—"}
                </td>
                <td className="px-3 py-3 pr-4 text-right text-lg font-bold text-brand-navy">
                  {li.qty}
                </td>
                <td className="px-3 py-3 pr-4">
                  {allocs.length === 0 ? (
                    <span className="text-xs italic text-brand-burgundy">
                      — keine Allokation —
                    </span>
                  ) : (
                    <div className="space-y-1">
                      {allocs.map((a, idx) => (
                        <div
                          key={idx}
                          className="font-mono text-xs leading-tight"
                        >
                          <span className="font-bold text-brand-navy">
                            {a.chargeNumber}
                          </span>
                          {" · "}
                          MHD {a.expiryDateIso ?? "—"}
                          {" · "}
                          <span className="font-bold">{a.qty} Stk</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-block h-5 w-5 border-2 border-brand-navy"></span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <footer className="mt-12 border-t border-zinc-300 pt-2 text-[10px] text-brand-navy/60">
        Order-ID: <span className="font-mono">{order.id}</span> · Status:{" "}
        {order.internal_status}
      </footer>
    </div>
  );
}
