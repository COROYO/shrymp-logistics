"use client";

import { useTranslations } from "next-intl";
import { ProductAccordion, type ProductRow } from "./product-accordion";

export type ProductsViewData = {
  rows: ProductRow[];
  batchesEnabled: boolean;
  locations: Array<{ id: string; name: string; isPrimary: boolean }>;
  defaultLocationId: string | null;
};

export function ProductsView({ initialData }: { initialData: ProductsViewData }) {
  const t = useTranslations("products");
  const { rows, batchesEnabled, locations, defaultLocationId } = initialData;
  const totals = {
    products: rows.length,
    activeBatches: rows.reduce((s, r) => s + r.batchCount, 0),
    onHand: rows.reduce((s, r) => s + r.totalOnHand, 0),
  };

  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-3 text-sm">
        <Stat label={t("stats.products")} value={totals.products} />
        {batchesEnabled ? (
          <Stat label={t("stats.activeBatches")} value={totals.activeBatches} />
        ) : (
          <Stat
            label={t("stats.variants")}
            value={rows.reduce((s, r) => s + r.variants.length, 0)}
          />
        )}
        <Stat label={t("stats.onHandTotal")} value={totals.onHand} />
      </dl>

      {rows.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-brand-navy/60">
          {t.rich("emptyNoSync", {
            link: (chunks) => (
              <a
                href="/admin/settings/shopify"
                className="font-semibold text-brand-burgundy underline-offset-2 hover:underline"
              >
                {chunks}
              </a>
            ),
          })}
        </div>
      ) : (
        <ProductAccordion
          rows={rows}
          batchesEnabled={batchesEnabled}
          locations={locations}
          defaultLocationId={defaultLocationId}
        />
      )}
    </>
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
