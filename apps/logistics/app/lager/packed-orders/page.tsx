import { getTranslations } from "next-intl/server";
import { adminDb } from "@/server/firestore/admin";
import { type Order } from "@/server/firestore/schema";
import { ordersForShop } from "@/server/tenant/queries";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { PackedTable, type PackedRow } from "./packed-table";

export const dynamic = "force-dynamic";

function tsToIso(t: unknown): string {
  if (!t) return "";
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  return "";
}

async function loadPacked(shopId: string): Promise<PackedRow[]> {
  const db = adminDb();
  const snap = await ordersForShop(db, shopId)
    .where("internal_status", "==", "PACKED")
    .limit(300)
    .get();

  const rows: PackedRow[] = snap.docs.map((d) => {
    const data = d.data() as Order;
    const itemCount = data.line_items.reduce((sum, li) => sum + li.qty, 0);
    return {
      id: data.id,
      name: data.name,
      packedIso: tsToIso(data.packed_at) || tsToIso(data.created_at_shopify),
      itemCount,
      positionCount: data.line_items.length,
      city: data.shipping_address?.city ?? null,
      tags: data.tags,
      isExpress: data.tags.includes("EXPRESS_DHL"),
      externallyFulfilled: data.externally_fulfilled === true,
      customerNote: data.customer_note ?? null,
    };
  });

  // Newest packed first.
  rows.sort((a, b) => b.packedIso.localeCompare(a.packedIso));
  return rows;
}

export default async function PackedOrdersPage() {
  const { shopId } = await requireTenantPageContext("/lager/packed-orders");
  const rows = await loadPacked(shopId);
  const t = await getTranslations("packedOrders");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
            {t("intro")}
          </p>
        </div>
        <div className="card flex items-center gap-3 px-4 py-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-brand-burgundy" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
            {t("stats.packed")}
          </span>
          <span className="text-lg font-bold text-brand-navy">
            {rows.length}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-brand-navy/60">
          {t("empty")}
        </div>
      ) : (
        <PackedTable rows={rows} />
      )}
    </div>
  );
}
