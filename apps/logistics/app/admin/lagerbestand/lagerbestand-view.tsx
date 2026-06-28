"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  LagerbestandTable,
  type LagerbestandRow,
} from "./lagerbestand-table";

async function fetchInventoryRows(): Promise<LagerbestandRow[]> {
  const r = await fetch("/api/v1/inventory");
  if (!r.ok) throw new Error("fetch_failed");
  const payload = (await r.json()) as { data: { rows: LagerbestandRow[] } };
  return payload.data.rows;
}

export function LagerbestandView({
  initialRows,
}: {
  initialRows: LagerbestandRow[];
}) {
  const t = useTranslations("lagerbestand");
  const [rows, setRows] = useState(initialRows);

  const reload = useCallback(async () => {
    try {
      setRows(await fetchInventoryRows());
    } catch {
      /* keep current rows on a transient refetch error */
    }
  }, []);

  const totals = rows.reduce(
    (acc, r) => ({
      onHand: acc.onHand + r.onHand,
      reserved: acc.reserved + r.reserved,
      difference: acc.difference + r.difference,
    }),
    { onHand: 0, reserved: 0, difference: 0 },
  );

  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-4 text-sm">
        <Stat label={t("stats.variants")} value={rows.length} />
        <Stat label={t("stats.onHand")} value={totals.onHand} />
        <Stat label={t("stats.reserved")} value={totals.reserved} />
        <Stat label={t("stats.difference")} value={totals.difference} />
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
        <LagerbestandTable rows={rows} onReload={reload} />
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
