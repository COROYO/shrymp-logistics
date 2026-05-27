import { notFound } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import { PrintTrigger } from "../print/print-trigger";

export const dynamic = "force-dynamic";

type AllocLine = {
  lineItemId: string;
  chargeNumber: string;
  expiryDateIso: string | null;
  qty: number;
};

async function load(orderId: string) {
  const db = adminDb();
  const orderSnap = await db
    .collection(Collections.Orders)
    .doc(orderId)
    .get();
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

  return { order, allocsByLi };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function tsToDate(t: unknown): Date | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate();
  if (typeof o.seconds === "number") return new Date(o.seconds * 1000);
  return null;
}

export default async function PackingSlipPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const data = await load(orderId);
  if (!data) notFound();
  const { order, allocsByLi } = data;

  const orderDate = tsToDate(order.created_at_shopify);
  const orderDateStr = orderDate
    ? orderDate.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

  return (
    <div className="bg-white text-black p-10 print:p-0 max-w-[210mm] mx-auto text-[12pt]">
      <PrintTrigger />

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 18mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* Absender-Briefkopf + Datum */}
      <header className="flex items-start justify-between border-b border-black pb-3">
        <div>
          <div className="text-xl font-bold tracking-tight">
            Monolith Caviar
          </div>
          <div className="text-[10pt] text-zinc-700 leading-snug mt-1">
            Ikrinka GmbH · Musterstraße 1 · 10115 Berlin
            <br />
            kontakt@monolithcaviar.de
          </div>
        </div>
        <div className="text-right text-[10pt] text-zinc-700">
          <div>Lieferschein</div>
          <div className="font-mono text-base font-semibold text-black mt-1">
            {order.name}
          </div>
          <div className="mt-1">Bestelldatum: {orderDateStr}</div>
        </div>
      </header>

      {/* Lieferadresse — groß zum Aufkleben/Falten */}
      <section className="mt-10">
        <div className="text-[9pt] text-zinc-600 uppercase tracking-wide mb-1">
          Lieferadresse
        </div>
        <address className="not-italic text-[14pt] leading-relaxed">
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

      {/* Anrede + Inhalt */}
      <section className="mt-10">
        <p className="text-[11pt]">
          Liebe:r {order.shipping_address?.first_name ?? "Kunde:in"},
        </p>
        <p className="mt-2 text-[11pt]">
          vielen Dank für deine Bestellung. Anbei findest du den Inhalt deiner
          Lieferung mit Chargennummern und Mindesthaltbarkeitsdatum zur
          Rückverfolgbarkeit.
        </p>
      </section>

      <table className="mt-6 w-full text-[11pt] border-collapse">
        <thead className="border-b-2 border-black">
          <tr className="text-left">
            <th className="py-2 font-semibold">Produkt</th>
            <th className="py-2 font-semibold text-right pr-4">Menge</th>
            <th className="py-2 font-semibold">Charge</th>
            <th className="py-2 font-semibold">MHD</th>
          </tr>
        </thead>
        <tbody>
          {order.line_items.map((li) => {
            const allocs = allocsByLi.get(li.id) ?? [];
            // One row per (line item × charge) so the customer sees exactly
            // which charge they got, separately per line.
            if (allocs.length === 0) {
              return (
                <tr key={li.id} className="border-b border-zinc-300">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{li.title}</div>
                  </td>
                  <td className="py-2 pr-4 text-right">{li.qty}</td>
                  <td className="py-2 pr-4 text-zinc-500 italic">—</td>
                  <td className="py-2 text-zinc-500 italic">—</td>
                </tr>
              );
            }
            return allocs.map((a, idx) => (
              <tr
                key={`${li.id}-${idx}`}
                className="border-b border-zinc-300 align-top"
              >
                <td className="py-2 pr-4">
                  {idx === 0 ? (
                    <div className="font-medium">{li.title}</div>
                  ) : null}
                </td>
                <td className="py-2 pr-4 text-right">{a.qty}</td>
                <td className="py-2 pr-4 font-mono">{a.chargeNumber}</td>
                <td className="py-2 font-mono">
                  {formatDate(a.expiryDateIso)}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>

      {/* Hinweise */}
      <section className="mt-12 text-[10pt] leading-relaxed text-zinc-700">
        <p>
          Bewahre den Lieferschein bitte mit der Charge und dem MHD auf,
          falls du Rückfragen zur Lieferung hast.
        </p>
        <p className="mt-3">
          Bei Fragen erreichst du uns unter <strong>kontakt@monolithcaviar.de</strong>.
        </p>
        <p className="mt-6 font-medium">
          Vielen Dank und guten Appetit!
          <br />
          Dein Monolith-Team
        </p>
      </section>

      <footer className="mt-16 border-t border-zinc-300 pt-2 text-[8pt] text-zinc-500 flex justify-between">
        <span>Lieferschein zu Bestellung {order.name}</span>
        <span>
          Ikrinka GmbH · USt-IdNr. DE… · HRB … · Geschäftsführung: …
        </span>
      </footer>
    </div>
  );
}
