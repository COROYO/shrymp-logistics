import Link from "next/link";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";

export const dynamic = "force-dynamic";

type Row = Order & { _createdIso: string; itemCount: number; isExpress: boolean };

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
    // Express first, then by created_at ASC (älteste zuerst)
    if (a.isExpress !== b.isExpress) return a.isExpress ? -1 : 1;
    return a._createdIso.localeCompare(b._createdIso);
  });

  return rows;
}

export default async function PickingQueuePage() {
  const rows = await loadQueue();
  const shipCount = rows.filter((r) => r.internal_status === "SHIP").length;
  const pickingCount = rows.filter((r) => r.internal_status === "PICKING").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Picking-Queue</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {shipCount} fertig zum Picken, {pickingCount} in Bearbeitung.
          Express-Orders zuerst, dann nach Bestelldatum.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-sm text-zinc-500">
            Keine Orders zum Picken. Schöner Tag.
          </p>
        ) : (
          <table className="w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Erstellt</th>
                <th className="px-4 py-2 font-medium">Items</th>
                <th className="px-4 py-2 font-medium">Stadt</th>
                <th className="px-4 py-2 font-medium">Tags</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((o) => {
                const cta =
                  o.internal_status === "PICKING"
                    ? "Weiter packen →"
                    : "Picken starten →";
                return (
                  <tr key={o.id} className={o.isExpress ? "bg-purple-50/40" : ""}>
                    <td className="px-4 py-2 font-mono font-semibold">
                      {o.name}
                    </td>
                    <td className="px-4 py-2 text-zinc-500">
                      {o._createdIso
                        ? new Date(o._createdIso).toLocaleString("de-DE", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {o.itemCount}{" "}
                      <span className="text-zinc-400 text-xs">
                        ({o.line_items.length} Pos.)
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-600">
                      {o.shipping_address?.city ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {o.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              t === "EXPRESS_DHL"
                                ? "bg-purple-200 text-purple-900 font-semibold"
                                : "bg-zinc-100 text-zinc-700"
                            }`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
                          o.internal_status === "PICKING"
                            ? "bg-violet-100 text-violet-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {o.internal_status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Link
                        href={`/lager/picking/${o.id}/slip`}
                        target="_blank"
                        className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline mr-3"
                        title="Packing-Slip drucken"
                      >
                        🧾 Slip
                      </Link>
                      <Link
                        href={`/lager/picking/${o.id}/print`}
                        target="_blank"
                        className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline mr-3"
                        title="Picklist drucken"
                      >
                        📋 Picklist
                      </Link>
                      <Link
                        href={`/lager/picking/${o.id}`}
                        className="text-sm font-medium text-zinc-900 hover:underline"
                      >
                        {cta}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
