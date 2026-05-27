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
    <div className="mx-auto max-w-[210mm] bg-white p-10 text-[12pt] text-brand-ink print:p-0">
      <PrintTrigger />

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 18mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* Absender-Briefkopf + Datum */}
      <header className="flex items-start justify-between border-b-[3px] border-brand-burgundy pb-3">
        <div>
          <div className="text-[10pt] font-semibold uppercase tracking-[0.18em] text-brand-burgundy">
            Ikrinka · Premium Quality
          </div>
          <div className="mt-1 text-xl font-bold tracking-tight text-brand-navy">
            Monolith Caviar
          </div>
          <div className="mt-1 text-[10pt] leading-snug text-brand-navy/70">
            Ikrinka GmbH · Musterstraße 1 · 10115 Berlin
            <br />
            kontakt@monolithcaviar.de
          </div>
        </div>
        <div className="text-right text-[10pt] text-brand-navy/70">
          <div className="text-[10pt] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
            Lieferschein
          </div>
          <div className="mt-1 font-mono text-base font-bold text-brand-navy">
            {order.name}
          </div>
          <div className="mt-1">Bestelldatum: {orderDateStr}</div>
        </div>
      </header>

      {/* Lieferadresse — groß zum Aufkleben/Falten */}
      <section className="mt-10">
        <div className="mb-1 text-[10pt] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
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

      <table className="mt-6 w-full border-collapse text-[11pt]">
        <thead>
          <tr className="bg-brand-navy text-left text-white">
            <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
              Produkt
            </th>
            <th className="px-3 py-2 pr-4 text-right text-[10pt] font-semibold uppercase tracking-[0.1em]">
              Menge
            </th>
            <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
              Charge
            </th>
            <th className="px-3 py-2 text-[10pt] font-semibold uppercase tracking-[0.1em]">
              MHD
            </th>
          </tr>
        </thead>
        <tbody>
          {order.line_items.map((li) => {
            const allocs = allocsByLi.get(li.id) ?? [];
            if (allocs.length === 0) {
              return (
                <tr key={li.id} className="border-b border-zinc-300">
                  <td className="px-3 py-2 pr-4">
                    <div className="font-semibold text-brand-navy">
                      {li.title}
                    </div>
                  </td>
                  <td className="px-3 py-2 pr-4 text-right">{li.qty}</td>
                  <td className="px-3 py-2 pr-4 italic text-brand-navy/40">
                    —
                  </td>
                  <td className="px-3 py-2 italic text-brand-navy/40">—</td>
                </tr>
              );
            }
            return allocs.map((a, idx) => (
              <tr
                key={`${li.id}-${idx}`}
                className="border-b border-zinc-300 align-top"
              >
                <td className="px-3 py-2 pr-4">
                  {idx === 0 ? (
                    <div className="font-semibold text-brand-navy">
                      {li.title}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 pr-4 text-right">{a.qty}</td>
                <td className="px-3 py-2 pr-4 font-mono">{a.chargeNumber}</td>
                <td className="px-3 py-2 font-mono">
                  {formatDate(a.expiryDateIso)}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>

      {/* Hinweise */}
      <section className="mt-12 text-[10pt] leading-relaxed text-brand-navy/80">
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

      <footer className="mt-16 flex justify-between border-t border-zinc-300 pt-2 text-[8pt] text-brand-navy/60">
        <span>
          Lieferschein zu Bestellung{" "}
          <span className="font-mono">{order.name}</span>
        </span>
        <span>
          Ikrinka GmbH · USt-IdNr. DE… · HRB … · Geschäftsführung: …
        </span>
      </footer>
    </div>
  );
}
