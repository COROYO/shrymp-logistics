import Link from "next/link";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";

export const dynamic = "force-dynamic";

type Row = Order & {
  _createdIso: string;
  itemCount: number;
  isExpress: boolean;
};

async function loadQueue(): Promise<Row[]> {
  const db = adminDb();
  const snap = await db
    .collection(Collections.Orders)
    .where("internal_status", "in", ["SHIP", "PICKING"])
    .limit(200)
    .get();

  const rows: Row[] = snap.docs.map((d) => {
    const data = d.data() as Order;
    const ts = data.created_at_shopify as unknown as
      | { toDate?(): Date; seconds?: number }
      | undefined;
    let iso = "";
    if (ts && typeof (ts as { toDate?: unknown }).toDate === "function") {
      iso = (ts as { toDate(): Date }).toDate().toISOString();
    } else if (ts && typeof (ts as { seconds?: number }).seconds === "number") {
      iso = new Date((ts as { seconds: number }).seconds * 1000).toISOString();
    }
    const itemCount = data.line_items.reduce((sum, li) => sum + li.qty, 0);
    return {
      ...data,
      _createdIso: iso,
      itemCount,
      isExpress: data.tags.includes("EXPRESS_DHL"),
    };
  });

  rows.sort((a, b) => {
    if (a.isExpress !== b.isExpress) return a.isExpress ? -1 : 1;
    return a._createdIso.localeCompare(b._createdIso);
  });

  return rows;
}

export default async function PickingQueuePage() {
  const rows = await loadQueue();
  const shipCount = rows.filter((r) => r.internal_status === "SHIP").length;
  const pickingCount = rows.filter(
    (r) => r.internal_status === "PICKING",
  ).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Picking</p>
          <h1 className="h-display mt-1 text-3xl">Picking-Queue</h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
            Express-Orders zuerst, danach nach Bestelldatum (älteste zuerst).
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Stat label="Ready" value={shipCount} accent="emerald" />
          <Stat label="In Bearbeitung" value={pickingCount} accent="violet" />
        </div>
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-brand-navy/60">
            Keine Orders zum Picken. Schöner Tag.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-brand">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Erstellt</th>
                  <th>Items</th>
                  <th>Stadt</th>
                  <th>Tags</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const cta =
                    o.internal_status === "PICKING"
                      ? "Weiter packen →"
                      : "Picken starten →";
                  return (
                    <tr
                      key={o.id}
                      className={
                        o.isExpress ? "bg-brand-burgundy-soft/40" : undefined
                      }
                    >
                      <td className="font-mono text-sm font-bold text-brand-navy">
                        {o.name}
                      </td>
                      <td className="text-sm text-brand-navy/60">
                        {o._createdIso
                          ? new Date(o._createdIso).toLocaleString("de-DE", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "—"}
                      </td>
                      <td className="text-sm">
                        <span className="font-semibold text-brand-navy">
                          {o.itemCount}
                        </span>{" "}
                        <span className="text-xs text-brand-navy/50">
                          ({o.line_items.length} Pos.)
                        </span>
                      </td>
                      <td className="text-xs text-brand-navy/70">
                        {o.shipping_address?.city ?? "—"}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {o.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className={
                                t === "EXPRESS_DHL"
                                  ? "chip chip-burgundy"
                                  : "chip chip-soft"
                              }
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span
                          className={
                            o.internal_status === "PICKING"
                              ? "chip chip-violet"
                              : "chip chip-emerald"
                          }
                        >
                          {o.internal_status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <Link
                          href={`/lager/picking/${o.id}/slip`}
                          target="_blank"
                          className="mr-4 text-[11px] font-semibold uppercase tracking-wide text-brand-navy/50 hover:text-brand-burgundy"
                          title="Packing-Slip drucken"
                        >
                          Slip
                        </Link>
                        <Link
                          href={`/lager/picking/${o.id}/print`}
                          target="_blank"
                          className="mr-4 text-[11px] font-semibold uppercase tracking-wide text-brand-navy/50 hover:text-brand-burgundy"
                          title="Picklist drucken"
                        >
                          Picklist
                        </Link>
                        <Link
                          href={`/lager/picking/${o.id}`}
                          className="text-sm font-semibold text-brand-burgundy hover:text-brand-burgundy-dark"
                        >
                          {cta}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "emerald" | "violet";
}) {
  const dot =
    accent === "emerald" ? "bg-emerald-500" : "bg-violet-500";
  return (
    <div className="card flex items-center gap-3 px-4 py-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </span>
      <span className="text-lg font-bold text-brand-navy">{value}</span>
    </div>
  );
}
