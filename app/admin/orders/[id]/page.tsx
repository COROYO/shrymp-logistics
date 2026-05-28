import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import { OrderNoteIcon } from "@/app/_components/order-note-icon";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("orderDetail");

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/orders"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-navy/60 transition hover:text-brand-burgundy"
        >
          {t("back")}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-3xl font-bold tracking-tight text-brand-navy">
            <span className="inline-flex items-center gap-2">
              <OrderNoteIcon note={order.customer_note} />
              {order.name}
            </span>
          </h1>
          <span
            className={
              order.internal_status === "CANCELLED"
                ? "chip chip-burgundy"
                : "chip chip-soft"
            }
          >
            {order.internal_status}
          </span>
          {order.tags.map((t) => (
            <span
              key={t}
              className={
                t === "EXPRESS_DHL" ? "chip chip-burgundy" : "chip chip-soft"
              }
            >
              {t}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-brand-navy/60">
          {t("metaOrderId")}{" "}
          <span className="font-mono">{order.id}</span> · {t("metaShopifyGid")}{" "}
          <span className="font-mono">{order.shopify_gid}</span> ·{" "}
          {t("metaCreated")}{" "}
          {createdIso ? new Date(createdIso).toLocaleString("de-DE") : "—"}
        </p>
      </div>

      {order.internal_status === "CANCELLED" ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-4 py-3 text-sm text-brand-burgundy-dark">
          <div className="font-semibold">{t("cancelled.title")}</div>
          <div className="mt-1 text-xs">
            {t("cancelled.reason")}:{" "}
            <span className="font-mono">
              {order.cancel_reason ?? t("cancelled.reasonUnknown")}
            </span>
            {order.cancelled_at ? (
              <>
                {" · "}
                {t("cancelled.cancelledAt")}{" "}
                {new Date(
                  (order.cancelled_at as unknown as { toDate?(): Date })
                    .toDate?.() ?? (order.cancelled_at as unknown as string),
                ).toLocaleString("de-DE")}
              </>
            ) : null}
          </div>
          <div className="mt-2 text-[11px]">
            {t("cancelled.allocationsReleased")}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="eyebrow">{t("address")}</h2>
          <address className="mt-2 not-italic text-sm leading-relaxed text-brand-ink">
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

        <section className="card p-5">
          <h2 className="eyebrow">{t("shopifyStatus")}</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <DefRow label={t("financial")}>
              {order.shopify_financial_status ?? "—"}
            </DefRow>
            <DefRow label={t("fulfillment")}>
              {order.shopify_fulfillment_status ?? "—"}
            </DefRow>
            <DefRow label={t("stopReason")}>
              {order.stop_reason ?? "—"}
            </DefRow>
            <DefRow label={t("allocationRun")}>
              {order.allocation_run_id ? (
                <span className="font-mono text-xs">
                  {order.allocation_run_id}
                </span>
              ) : (
                "—"
              )}
            </DefRow>
          </dl>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-zinc-200 px-6 py-4">
          <p className="eyebrow">{t("allocationsEyebrow")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {t("lineItemsTitle", {
              count: order.line_items.length,
              allocs: allocs.length,
            })}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-brand">
            <thead>
              <tr>
                <th>{t("table.position")}</th>
                <th>{t("table.sku")}</th>
                <th className="text-right">{t("table.qty")}</th>
                <th>{t("table.allocations")}</th>
              </tr>
            </thead>
            <tbody>
              {order.line_items.map((li) => {
                const liAllocs = allocs.filter((a) => a.line_item_id === li.id);
                return (
                  <tr key={li.id}>
                    <td>
                      <div className="font-semibold text-brand-navy">
                        {li.title}
                      </div>
                      <div className="text-xs text-brand-navy/60">
                        {t("table.variant")}{" "}
                        <span className="font-mono">{li.variant_id}</span>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-brand-navy/70">
                      {li.sku ?? "—"}
                    </td>
                    <td className="text-right text-base font-bold text-brand-navy">
                      {li.qty}
                    </td>
                    <td className="space-y-1 text-xs">
                      {liAllocs.length === 0 ? (
                        <span className="chip chip-amber">
                          {t("table.none")}
                        </span>
                      ) : (
                        liAllocs.map((a) => {
                          const b = batchById.get(a.batch_id);
                          const consumedIso = tsToIso(a.consumed_at);
                          return (
                            <div
                              key={a.id}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <span className="rounded-md bg-brand-navy px-2 py-0.5 font-mono font-semibold text-white">
                                {b?.charge_number ?? a.batch_id.slice(0, 6)}
                              </span>
                              <span className="font-semibold text-brand-navy">
                                {a.qty}×
                              </span>
                              {consumedIso ? (
                                <span className="text-emerald-700">
                                  {t("table.consumed", {
                                    when: new Date(
                                      consumedIso,
                                    ).toLocaleString("de-DE"),
                                  })}
                                </span>
                              ) : (
                                <span className="text-brand-navy/60">
                                  {t("table.reserved")}
                                </span>
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
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-zinc-200 px-6 py-4">
          <p className="eyebrow">{t("audit.eyebrow")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {t("audit.title", { count: movs.length })}
          </h2>
        </div>
        {movs.length === 0 ? (
          <p className="px-6 py-6 text-sm text-brand-navy/60">
            {t("audit.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-brand">
              <thead>
                <tr>
                  <th>{t("audit.when")}</th>
                  <th>{t("audit.type")}</th>
                  <th className="text-right">{t("audit.qty")}</th>
                  <th>{t("audit.charge")}</th>
                  <th>{t("audit.user")}</th>
                </tr>
              </thead>
              <tbody>
                {movs
                  .sort((a, b) => {
                    const ia = tsToIso(a.created_at) ?? "";
                    const ib = tsToIso(b.created_at) ?? "";
                    return ib.localeCompare(ia);
                  })
                  .map((m) => (
                    <tr key={m.id}>
                      <td className="text-xs text-brand-navy/60">
                        {(() => {
                          const iso = tsToIso(m.created_at);
                          return iso
                            ? new Date(iso).toLocaleString("de-DE")
                            : "—";
                        })()}
                      </td>
                      <td>
                        <span className="chip chip-soft">{m.type}</span>
                      </td>
                      <td
                        className={`text-right font-mono font-bold ${
                          m.qty < 0 ? "text-brand-burgundy" : "text-emerald-700"
                        }`}
                      >
                        {m.qty > 0 ? "+" : ""}
                        {m.qty}
                      </td>
                      <td className="font-mono text-xs">
                        {m.batch_id
                          ? (batchById.get(m.batch_id)?.charge_number ??
                            m.batch_id.slice(0, 8))
                          : "—"}
                      </td>
                      <td className="text-xs text-brand-navy/70">
                        {m.user_id ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
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
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd className="text-right text-sm text-brand-ink">{children}</dd>
    </div>
  );
}
