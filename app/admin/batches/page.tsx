import { getTranslations } from "next-intl/server";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
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

async function loadProductRows(): Promise<ProductRow[]> {
  const db = adminDb();
  const [productsSnap, variantsSnap, batchesSnap, allocationsSnap] =
    await Promise.all([
      db.collection(Collections.Products).get(),
      db.collection(Collections.Variants).get(),
      db
        .collection(Collections.Batches)
        .where("status", "==", "ACTIVE")
        .get(),
      // For "verkauft"-counter per batch: only allocations that were
      // actually consumed (= packed + shipped) count as sold. Released
      // allocations (cancelled orders) are skipped — they didn't leave
      // the warehouse.
      db.collection(Collections.Allocations).get(),
    ]);

  // Map batch_id → total sold qty (consumed, not released).
  const soldByBatch: Record<string, number> = {};
  for (const a of allocationsSnap.docs) {
    const data = a.data() as Allocation;
    if (!data.consumed_at) continue;
    if (data.released) continue;
    soldByBatch[data.batch_id] = (soldByBatch[data.batch_id] ?? 0) + data.qty;
  }

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
              remainingQty: b.remaining_qty,
              initialQty: b.initial_qty,
              soldQty: soldByBatch[b.id] ?? 0,
              status: b.status,
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
          const onHand =
            (v.on_hand_total as number | undefined) ??
            batches.reduce((s, b) => s + b.remainingQty, 0);
          const reserved = (v.reserved_total as number | undefined) ?? 0;
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
        batchCount: variants.reduce((s, v) => s + v.batches.length, 0),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return rows;
}

export default async function BatchesPage() {
  const rows = await loadProductRows();
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
