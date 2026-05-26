import Link from "next/link";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Order,
  type OrderInternalStatus,
} from "@/server/firestore/schema";

export const dynamic = "force-dynamic";

type Filter = "ALL" | OrderInternalStatus;
const FILTERS: Filter[] = [
  "ALL",
  "NEW",
  "SHIP",
  "STOP",
  "PACKED",
  "CANCELLED",
];

async function loadOrders(
  filter: Filter,
): Promise<(Order & { _createdIso: string })[]> {
  const db = adminDb();
  let q = db
    .collection(Collections.Orders)
    .orderBy("created_at_shopify", "desc")
    .limit(100);
  if (filter !== "ALL") {
    q = db
      .collection(Collections.Orders)
      .where("internal_status", "==", filter)
      .orderBy("created_at_shopify", "desc")
      .limit(100);
  }
  const snap = await q.get();
  return snap.docs.map((d) => {
    const data = d.data() as Order;
    const ts = data.created_at_shopify as unknown as
      | { toDate?(): Date; seconds?: number }
      | undefined;
    let iso = "";
    if (ts && typeof (ts as { toDate?: unknown }).toDate === "function") {
      iso = (ts as { toDate(): Date }).toDate().toISOString();
    } else if (ts && typeof (ts as { seconds?: number }).seconds === "number") {
      iso = new Date(
        (ts as { seconds: number }).seconds * 1000,
      ).toISOString();
    }
    return { ...data, _createdIso: iso };
  });
}

const STATUS_BADGE: Record<OrderInternalStatus, string> = {
  NEW: "bg-zinc-100 text-zinc-700",
  SHIP: "bg-emerald-100 text-emerald-800",
  STOP: "bg-amber-100 text-amber-800",
  PACKED: "bg-sky-100 text-sky-800",
  CANCELLED: "bg-zinc-200 text-zinc-600",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: Filter = (FILTERS as string[]).includes(status ?? "")
    ? (status as Filter)
    : "ALL";

  const orders = await loadOrders(filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Letzte 100 Bestellungen aus Shopify. Status wird vom
          Allocation-Run automatisch gesetzt.
        </p>
      </div>

      <nav className="flex flex-wrap items-center gap-2 text-sm">
        {FILTERS.map((f) => {
          const isActive = filter === f;
          return (
            <Link
              key={f}
              href={f === "ALL" ? "/admin/orders" : `/admin/orders?status=${f}`}
              className={`rounded-md px-3 py-1 ${
                isActive
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              {f}
            </Link>
          );
        })}
      </nav>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        {orders.length === 0 ? (
          <p className="px-6 py-8 text-sm text-zinc-500">
            Keine Bestellungen.
          </p>
        ) : (
          <table className="w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Erstellt</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Items</th>
                <th className="px-4 py-2 font-medium">Tags</th>
                <th className="px-4 py-2 font-medium">Stop-Grund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {orders.map((o) => {
                const itemCount = o.line_items.reduce(
                  (sum, li) => sum + li.qty,
                  0,
                );
                return (
                  <tr key={o.id}>
                    <td className="px-4 py-2 font-mono">{o.name}</td>
                    <td className="px-4 py-2 text-zinc-500">
                      {o._createdIso
                        ? new Date(o._createdIso).toLocaleString("de-DE")
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
                          STATUS_BADGE[o.internal_status]
                        }`}
                      >
                        {o.internal_status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {itemCount} ({o.line_items.length} LineItems)
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {o.tags.map((t) => (
                          <span
                            key={t}
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              t === "EXPRESS_DHL"
                                ? "bg-purple-100 text-purple-800"
                                : "bg-zinc-100 text-zinc-700"
                            }`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500">
                      {o.stop_reason ?? ""}
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
