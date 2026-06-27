import { getTranslations } from "next-intl/server";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Product,
  type User,
  type Variant,
} from "@/server/firestore/schema";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import {
  allocationsForShop,
  batchesForShop,
  productsForShop,
  variantsForShop,
} from "@/server/tenant/queries";
import { isBatchExpired } from "@/server/picking/batch-assignability";
import { ProductAccordion, type ProductRow } from "./product-accordion";

export const dynamic = "force-dynamic";

function tsToIso(t: unknown): string | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function")
    return o.toDate().toISOString().slice(0, 10);
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString().slice(0, 10);
  return null;
}

async function loadProductRows(shopId: string): Promise<ProductRow[]> {
  // Expiry persistence is handled by the reconcile cron — the UI already flags
  // expired batches live via `isBatchExpired`, so we don't mutate on read.
  const db = adminDb();
  const referenceDate = new Date();
  const [productsSnap, variantsSnap, batchesSnap, allocationsSnap] =
    await Promise.all([
      productsForShop(db, shopId).get(),
      variantsForShop(db, shopId).get(),
      batchesForShop(db, shopId).get(),
      allocationsForShop(db, shopId).get(),
    ]);

  // Resolve only the uids that actually appear on this shop's batches.
  const receiverUids = Array.from(
    new Set(
      batchesSnap.docs
        .map((d) => (d.data() as Batch).received_by_uid)
        .filter((uid): uid is string => !!uid),
    ),
  );
  const userNameByUid: Record<string, string> = {};
  if (receiverUids.length > 0) {
    const userSnaps = await db.getAll(
      ...receiverUids.map((uid) => db.collection(Collections.Users).doc(uid)),
    );
    for (const u of userSnaps) {
      if (!u.exists) continue;
      const data = u.data() as User;
      userNameByUid[u.id] = data.display_name || data.email || u.id;
    }
  }

  // Reserved per variant — computed LIVE from SHIP/PICKING order demand (the
  // authoritative source), not from the drift-prone variant.reserved_total
  // cache. Keeps this page consistent with the orders view.
  const { loadReservedByVariant } = await import("@/server/inventory/reserved");
  const reservedByVariant = await loadReservedByVariant(shopId);

  // Map batch_id → total sold qty (consumed, not released).
  const soldByBatch: Record<string, number> = {};
  const openAllocQtyByBatch = new Map<string, number>();
  for (const a of allocationsSnap.docs) {
    const data = a.data() as Allocation;
    if (data.released) continue;
    if (data.consumed_at) {
      soldByBatch[data.batch_id] = (soldByBatch[data.batch_id] ?? 0) + data.qty;
      continue;
    }
    openAllocQtyByBatch.set(
      data.batch_id,
      (openAllocQtyByBatch.get(data.batch_id) ?? 0) + data.qty,
    );
  }

  const { computeShippableQtyByVariant } = await import(
    "@/server/inventory/shippable-stock"
  );
  const { loadLagerConfig } = await import("@/server/lager/config");
  const lagerCfg = await loadLagerConfig(shopId);
  const allBatches = batchesSnap.docs.map((d) => ({
    ...(d.data() as Batch),
    id: d.id,
  }));
  const shippableByVariant = computeShippableQtyByVariant(
    allBatches,
    openAllocQtyByBatch,
    lagerCfg.batch_min_days_before_expiry,
  );

  const products: Record<string, Product> = {};
  for (const p of productsSnap.docs) products[p.id] = p.data() as Product;

  const variantsByProduct: Record<string, Variant[]> = {};
  for (const v of variantsSnap.docs) {
    const data = v.data() as Variant;
    (variantsByProduct[data.product_id] ??= []).push(data);
  }

  const batchesByVariant: Record<string, Batch[]> = {};
  for (const b of batchesSnap.docs) {
    const data = b.data() as Batch;
    (batchesByVariant[data.variant_id] ??= []).push(data);
  }

  const rows: ProductRow[] = Object.values(products)
    // Hide archived products and Shopify bundle parents (no own physical stock).
    .filter((p) => p.status !== "ARCHIVED" && p.is_bundle !== true)
    .map((p) => {
      const variants = (variantsByProduct[p.id] ?? [])
        .map((v) => {
          const batches = (batchesByVariant[v.id] ?? [])
            .map((b) => ({
              id: b.id,
              chargeNumber: b.charge_number,
              expiryDateIso: tsToIso(b.expiry_date) ?? "",
              productionDateIso: tsToIso(b.production_date),
              receivedAtIso: tsToIso(b.received_at),
              receivedByUid: b.received_by_uid,
              receivedByName:
                userNameByUid[b.received_by_uid] ?? b.received_by_uid,
              remainingQty: b.remaining_qty,
              initialQty: b.initial_qty,
              soldQty: soldByBatch[b.id] ?? 0,
              status: b.status,
              expired:
                b.status === "EXPIRED" ||
                isBatchExpired(b.expiry_date, referenceDate),
              notes: b.notes ?? null,
            }))
            .sort((a, b) => {
              if (a.expiryDateIso === b.expiryDateIso) {
                return a.chargeNumber.localeCompare(b.chargeNumber);
              }
              if (!a.expiryDateIso) return 1;
              if (!b.expiryDateIso) return -1;
              return a.expiryDateIso.localeCompare(b.expiryDateIso);
            });
          const onHand = shippableByVariant.get(v.id) ?? 0;
          const reserved = reservedByVariant.get(v.id) ?? 0;
          return {
            id: v.id,
            title: v.title,
            sku: v.sku ?? null,
            priceCents: v.price_cents ?? null,
            currency: v.currency ?? null,
            imageUrl: v.image_url ?? null,
            onHand,
            reserved,
            available: onHand - reserved,
            batches,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title));

      const totalOnHand = variants.reduce((s, v) => s + v.onHand, 0);
      const totalAvailable = variants.reduce((s, v) => s + v.available, 0);

      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        imageUrl: p.image_url ?? null,
        status: p.status,
        variants,
        totalOnHand,
        totalAvailable,
        // Header count reflects the active, non-empty batches (the ones shown
        // by default). Archived/empty ones live behind the panel toggle.
        batchCount: variants.reduce(
          (s, v) =>
            s +
            v.batches.filter(
              (b) => b.status === "ACTIVE" && b.remainingQty > 0 && !b.expired,
            ).length,
          0,
        ),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return rows;
}

export default async function BatchesPage() {
  const { shopId } = await requireTenantPageContext("/admin/batches");
  const { loadLagerConfig } = await import("@/server/lager/config");
  const [rows, lagerCfg] = await Promise.all([
    loadProductRows(shopId),
    loadLagerConfig(shopId),
  ]);
  const t = await getTranslations("batches");
  const totals = {
    products: rows.length,
    activeBatches: rows.reduce((s, r) => s + r.batchCount, 0),
    onHand: rows.reduce((s, r) => s + r.totalOnHand, 0),
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      {!lagerCfg.batches_enabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Chargen-Tracking ist deaktiviert. Die Zuordnung beim Lieferschein-Druck
          ist aus — du kannst Chargen weiter pflegen, sie beeinflussen aber
          Allocation und Versand nicht.{" "}
          <a
            href="/admin/settings/chargen"
            className="font-semibold text-brand-burgundy underline"
          >
            In den Einstellungen aktivieren
          </a>
        </div>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-3 text-sm">
        <Stat label={t("stats.products")} value={totals.products} />
        <Stat label={t("stats.activeBatches")} value={totals.activeBatches} />
        <Stat label={t("stats.onHandTotal")} value={totals.onHand} />
      </dl>

      {rows.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-brand-navy/60">
          {t.rich("emptyNoSync", {
            link: (chunks) => (
              <a
                href="/admin/products"
                className="font-semibold text-brand-burgundy underline-offset-2 hover:underline"
              >
                {chunks}
              </a>
            ),
          })}
        </div>
      ) : (
        <ProductAccordion rows={rows} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="card p-5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd className="mt-1.5 text-2xl font-bold tabular-nums text-brand-navy">
        {value}
      </dd>
    </div>
  );
}
