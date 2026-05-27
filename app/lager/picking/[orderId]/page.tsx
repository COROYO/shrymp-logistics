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
import { OrderNoteIcon } from "@/app/_components/order-note-icon";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("pickingDetail");

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/lager/picking"
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
            className={isPicking ? "chip chip-violet" : "chip chip-emerald"}
          >
            {order.internal_status}
          </span>
          {isExpress ? (
            <span className="chip chip-burgundy">{t("express")}</span>
          ) : null}
        </div>
      </div>

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

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4">
          <div>
            <p className="eyebrow">{t("items.eyebrow")}</p>
            <h2 className="mt-1 text-sm font-semibold text-brand-navy">
              {t("items.positions", { count: lineItems.length })}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/lager/picking/${order.id}/print`}
              target="_blank"
              className="btn-ghost"
            >
              {t("items.printPicklist")}
            </Link>
            <Link
              href={`/lager/picking/${order.id}/slip`}
              target="_blank"
              className="btn-ghost"
            >
              {t("items.printSlip")}
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-brand">
            <thead>
              <tr>
                <th>{t("items.product")}</th>
                <th>{t("items.sku")}</th>
                <th className="text-right">{t("items.qty")}</th>
                <th>{t("items.charge")}</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.id}>
                  <td>
                    <div className="font-semibold text-brand-navy">
                      {li.productTitle}
                    </div>
                    <div className="text-xs text-brand-navy/60">
                      {li.variantTitle}
                    </div>
                  </td>
                  <td className="font-mono text-xs text-brand-navy/70">
                    {li.sku ?? "—"}
                  </td>
                  <td className="text-right text-lg font-bold text-brand-navy">
                    {li.qty}
                  </td>
                  <td>
                    {li.allocations.length === 0 ? (
                      <span className="chip chip-amber">
                        {t("items.noCharge")}
                      </span>
                    ) : (
                      <div className="space-y-1">
                        {li.allocations.map((a, idx) => (
                          <div
                            key={`${a.batchId}-${idx}`}
                            className="flex flex-wrap items-baseline gap-2 text-xs"
                          >
                            <span className="rounded-md bg-brand-navy px-2 py-0.5 font-mono font-semibold text-white">
                              {a.chargeNumber}
                            </span>
                            <span className="font-semibold text-brand-navy">
                              {a.qty} {t("items.qtyUnit")}
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
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {isPickable ? <StartPickingButton orderId={order.id} /> : null}
        {isPicking ? (
          <>
            <Link
              href={`/lager/packing/${order.id}`}
              className="btn-primary"
            >
              {t("actions.continueToPack")}
            </Link>
            <CancelPickingButton orderId={order.id} />
          </>
        ) : null}
        {!isPickable && !isPicking ? (
          <span className="text-sm text-brand-navy/60">
            {t.rich("wrongStatus", {
              status: order.internal_status,
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
