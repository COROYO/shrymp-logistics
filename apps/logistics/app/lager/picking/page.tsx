import { getTranslations } from "next-intl/server";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";
import { QueueTable, type QueueRow } from "./queue-table";

import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { ordersForShop } from "@/server/tenant/queries";

export const dynamic = "force-dynamic";

async function loadQueue(shopId: string): Promise<QueueRow[]> {
  const db = adminDb();
  const snap = await ordersForShop(db, shopId)
    .where("internal_status", "in", ["SHIP", "PICKING"])
    .limit(200)
    .get();

  const rows: QueueRow[] = snap.docs.map((d) => {
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
    const isExpress = data.tags.includes("EXPRESS_DHL");
    return {
      id: data.id,
      name: data.name,
      createdIso: iso,
      itemCount,
      positionCount: data.line_items.length,
      city: data.shipping_address?.city ?? null,
      tags: data.tags,
      internal_status: data.internal_status as "SHIP" | "PICKING",
      isExpress,
      customerNote: data.customer_note ?? null,
    };
  });

  rows.sort((a, b) => {
    if (a.isExpress !== b.isExpress) return a.isExpress ? -1 : 1;
    return a.createdIso.localeCompare(b.createdIso);
  });

  return rows;
}

export default async function PickingQueuePage() {
  const { shopId } = await requireTenantPageContext("/lager/picking");
  const rows = await loadQueue(shopId);
  const t = await getTranslations("picking.queue");
  const shipCount = rows.filter((r) => r.internal_status === "SHIP").length;
  const pickingCount = rows.filter(
    (r) => r.internal_status === "PICKING",
  ).length;

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
        <div className="flex gap-3 text-sm">
          <Stat label={t("stats.ready")} value={shipCount} accent="emerald" />
          <Stat
            label={t("stats.inProgress")}
            value={pickingCount}
            accent="violet"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-brand-navy/60">
          {t("empty")}
        </div>
      ) : (
        <QueueTable rows={rows} />
      )}
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
  const dot = accent === "emerald" ? "bg-emerald-500" : "bg-violet-500";
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
