"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { StatSkeleton, TableSkeleton } from "@/app/_components/table-skeleton";
import { ProductAccordion, type ProductRow } from "./product-accordion";

type ProductsPayload = {
  rows: ProductRow[];
  batchesEnabled: boolean;
  locations: Array<{ id: string; name: string; isPrimary: boolean }>;
  defaultLocationId: string | null;
};

export function ProductsDataLoader() {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const [data, setData] = useState<ProductsPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setData(null);

    fetch("/api/v1/batches")
      .then((r) => {
        if (!r.ok) throw new Error("fetch_failed");
        return r.json() as Promise<{
          data: ProductsPayload;
        }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setData({
            rows: payload.data.rows,
            batchesEnabled: payload.data.batchesEnabled,
            locations: payload.data.locations,
            defaultLocationId: payload.data.defaultLocationId,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="card px-6 py-10 text-center text-sm text-red-700">
        Daten konnten nicht geladen werden.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-8">
        <StatSkeleton count={3} />
        <div className="card overflow-hidden relative">
          <div className="absolute inset-x-0 top-3 z-10 text-center text-xs text-brand-navy/50">
            {tCommon("loading")}
          </div>
          <TableSkeleton rows={8} cols={4} />
        </div>
      </div>
    );
  }

  const { rows, batchesEnabled, locations, defaultLocationId } = data;
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
          <Stat label={t("stats.variants")} value={rows.reduce((s, r) => s + r.variants.length, 0)} />
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
