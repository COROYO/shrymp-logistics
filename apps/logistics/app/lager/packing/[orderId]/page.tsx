import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
  type OrderDhlShipment,
} from "@/server/firestore/schema";
import { loadDhlConfig } from "@/server/dhl/config";
import { getShop } from "@/server/tenant/shop";
import { runWithTenantAsync } from "@/server/tenant/context";
import { signLabel } from "@/server/dhl/storage";
import { ConfirmPackingForm } from "./confirm-packing-form";
import { OrderNoteIcon } from "@/app/_components/order-note-icon";
import { getTranslations } from "next-intl/server";
import { DhlLabelButtons } from "./dhl-label-buttons";
import { DhlServicesBadges } from "./dhl-services-badges";
import { summarizeDhlServices } from "@/server/dhl/request-builder";
import { releaseUnshippableBatchAssignments } from "@/server/picking/release-invalid-assignments";
import { assertShopAccessibleForPage } from "@/lib/auth/tenant-page";

export const dynamic = "force-dynamic";

type AllocLine = {
  lineItemId: string;
  chargeNumber: string;
  expiryDateIso: string | null;
  qty: number;
};

async function loadOrderForPacking(orderId: string) {
  const db = adminDb();
  const orderSnap = await db.collection(Collections.Orders).doc(orderId).get();
  if (!orderSnap.exists) return null;
  const order = orderSnap.data() as Order;
  const shopId = order.shop_id;
  if (!shopId) return null;
  // Tenant gate before any mutation/read of foreign order data.
  await assertShopAccessibleForPage(shopId, `/lager/packing/${orderId}`);

  await releaseUnshippableBatchAssignments(orderId);

  return runWithTenantAsync(shopId, async () => {
    const [shop, dhlConfig] = await Promise.all([
      getShop(shopId),
      loadDhlConfig(shopId),
    ]);
    const shopDomain = shop?.shop_domain ?? "";

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

    const dhlShipmentForUi = await prepareDhlShipmentForUi(order);

    return { order, allocsByLi, shopDomain, dhlConfig, dhlShipmentForUi };
  });
}

type DhlShipmentForUi = {
  shipment_no: string;
  label_url?: string;
  tracking_url: string;
  weight_g: number;
  sandbox: boolean;
};

/**
 * Resolve a usable label URL for the UI: if the persisted signed URL is
 * still valid (>5 min remaining) reuse it; otherwise re-sign on the fly.
 */
async function prepareDhlShipmentForUi(
  order: Order,
): Promise<DhlShipmentForUi | null> {
  const s = order.dhl_shipment as OrderDhlShipment | undefined;
  if (!s) return null;
  let labelUrl = s.label_url;
  const exp = s.label_url_expires_at as unknown as
    | { toMillis?(): number }
    | string
    | Date
    | undefined;
  const expiresAt =
    exp && typeof (exp as { toMillis?: unknown }).toMillis === "function"
      ? (exp as { toMillis(): number }).toMillis()
      : exp instanceof Date
        ? exp.getTime()
        : typeof exp === "string"
          ? Date.parse(exp)
          : 0;
  if (!labelUrl || expiresAt - Date.now() < 5 * 60_000) {
    try {
      const resigned = await signLabel(order.id, s.shipment_no);
      labelUrl = resigned.signedUrl;
    } catch {
      // best-effort; UI will hide the open-button if missing
      labelUrl = undefined;
    }
  }
  return {
    shipment_no: s.shipment_no,
    label_url: labelUrl,
    tracking_url: s.tracking_url,
    weight_g: s.weight_g,
    sandbox: s.sandbox,
  };
}

export default async function PackingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const data = await loadOrderForPacking(orderId);
  if (!data) notFound();
  const { order, allocsByLi, shopDomain, dhlConfig, dhlShipmentForUi } = data;
  const defaultWeightG = dhlConfig?.default_weight_g ?? 1000;
  const dhlServices = summarizeDhlServices(order);

  const isPacking = order.internal_status === "PICKING";
  const isPacked = order.internal_status === "PACKED";
  const [t, tPack, tPage] = await Promise.all([
    getTranslations("packing"),
    getTranslations("packing.contents"),
    getTranslations("packingPage"),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/lager/picking/${order.id}`}
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-navy/60 transition hover:text-brand-burgundy"
        >
          {tPage("backToPicklist")}
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
              isPacked
                ? "chip chip-sky"
                : isPacking
                  ? "chip chip-violet"
                  : "chip chip-soft"
            }
          >
            {order.internal_status}
          </span>
        </div>
      </div>

      <section className="card p-5">
        <h2 className="eyebrow">{t("shippingAddress")}</h2>
        <address className="mt-2 not-italic text-base leading-relaxed text-brand-ink">
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

      <section className="card overflow-hidden">
        <div className="border-b border-zinc-200 px-6 py-4">
          <p className="eyebrow">{tPack("eyebrow")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {tPack("title")}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-brand">
            <thead>
              <tr>
                <th>{tPack("product")}</th>
                <th className="text-right">{tPack("qty")}</th>
                <th>{tPack("batches")}</th>
              </tr>
            </thead>
            <tbody>
              {order.line_items.map((li) => {
                const allocs = allocsByLi.get(li.id) ?? [];
                return (
                  <tr key={li.id}>
                    <td>
                      <div className="font-semibold text-brand-navy">
                        {li.title}
                      </div>
                      {li.sku ? (
                        <div className="font-mono text-xs text-brand-navy/60">
                          SKU {li.sku}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-right text-lg font-bold text-brand-navy">
                      {li.qty}
                    </td>
                    <td className="text-xs">
                      <div className="flex flex-wrap gap-1.5">
                        {allocs.map((a, idx) => (
                          <span
                            key={idx}
                            className="rounded-md bg-brand-navy px-2 py-0.5 font-mono font-semibold text-white"
                          >
                            {a.chargeNumber} · {a.qty}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">{t("dhl.eyebrow")}</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          {t("dhl.title")}
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          {t.rich("dhl.intro", { b: (chunks) => <strong>{chunks}</strong> })}
        </p>
        <DhlServicesBadges services={dhlServices} />
        <div className="mt-4">
          <DhlLabelButtons
            orderId={order.id}
            shopDomain={shopDomain}
            countryCode={order.shipping_address?.country_code ?? null}
            existingShipment={dhlShipmentForUi}
            defaultWeightG={defaultWeightG}
            cod={{
              required: dhlServices.cod,
              defaultAmountCents: dhlServices.codAmountCents,
            }}
          />
        </div>
        {!dhlConfig &&
        (order.shipping_address?.country_code ?? "").toUpperCase() === "DE" ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {tPage.rich("notConfigured", {
              link: (chunks) => (
                <Link
                  href="/admin/settings"
                  className="font-semibold underline underline-offset-2"
                >
                  {chunks}
                </Link>
              ),
            })}
          </div>
        ) : null}
      </section>

      <div className="flex gap-3">
        <Link
          href={`/lager/picking/${order.id}/print`}
          target="_blank"
          className="btn-ghost"
        >
          {t("reprintPicklist")}
        </Link>
      </div>

      {isPacking ? (
        <section className="card p-6">
          <p className="eyebrow">{t("finish.eyebrow")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {t("finish.title")}
          </h2>
          <p className="mt-1 text-xs text-brand-navy/60">{t("finish.intro")}</p>
          <div className="mt-5">
            <ConfirmPackingForm orderId={order.id} />
          </div>
        </section>
      ) : isPacked ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {t("alerts.packed")}
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t.rich("alerts.wrongStatus", {
            status: order.internal_status,
            b: (chunks) => <strong>{chunks}</strong>,
          })}
        </div>
      )}
    </div>
  );
}
