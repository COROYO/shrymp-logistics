"use client";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FORECAST_HORIZONS, type ForecastHorizon } from "./constants";

export type ForecastRow = {
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  available: number;
  /** null → variant has no forecast (no sales history yet). */
  method: "HOLT_WINTERS" | "CROSTON" | "MOVING_AVERAGE" | "NONE" | null;
  avgDailyUnits: number;
  /** Units needed per horizon, already rounded up. Keyed by horizon days. */
  neededByHorizon: Record<number, number>;
  daysOfCover: number | null;
  backtestMae: number | null;
  historyDays: number;
  includesExplodedBundles: boolean;
};

export function ForecastTable({
  rows,
  generatedAtIso,
}: {
  rows: ForecastRow[];
  generatedAtIso: string | null;
}) {
  const t = useTranslations("forecasting");
  const locale = useLocale();
  const [horizon, setHorizon] = useState<ForecastHorizon>(30);
  const [query, setQuery] = useState("");

  const nf0 = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const nf1 = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }),
    [locale],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? rows.filter(
          (r) =>
            (r.sku ?? "").toLowerCase().includes(q) ||
            r.productTitle.toLowerCase().includes(q) ||
            (r.variantTitle ?? "").toLowerCase().includes(q),
        )
      : rows;
    return [...matches].sort((a, b) => {
      const aNeed = a.method ? (a.neededByHorizon[horizon] ?? 0) : -1;
      const bNeed = b.method ? (b.neededByHorizon[horizon] ?? 0) : -1;
      if (bNeed !== aNeed) return bNeed - aNeed;
      return (a.sku ?? "").localeCompare(b.sku ?? "");
    });
  }, [rows, query, horizon]);

  const withForecast = rows.filter((r) => r.method != null);
  const reorderCount = withForecast.filter(
    (r) => r.available < (r.neededByHorizon[horizon] ?? 0),
  ).length;

  const generatedLabel = generatedAtIso
    ? new Date(generatedAtIso).toLocaleString(locale, {
        timeZone: "Europe/Berlin",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <Stat label={t("stats.skus")} value={nf0.format(withForecast.length)} />
          <Stat
            label={t("stats.reorder", { days: horizon })}
            value={nf0.format(reorderCount)}
            tone={reorderCount > 0 ? "alert" : "default"}
          />
          {generatedLabel ? (
            <span className="pb-1 text-xs text-brand-navy/50">
              {t("stats.generated")}: {generatedLabel}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-md border border-brand-navy/15">
            {FORECAST_HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={
                  h === horizon
                    ? "bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white"
                    : "bg-white px-3 py-1.5 text-xs font-medium text-brand-navy/70 transition hover:bg-brand-navy/5"
                }
              >
                {t("horizon.days", { days: h })}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("table.search")}
            className="w-56 rounded-md border border-brand-navy/15 px-3 py-1.5 text-sm outline-none focus:border-brand-navy/40"
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        {filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-brand-navy/60">
            {t("empty")}
          </p>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-brand-navy/10 text-left text-xs uppercase tracking-wide text-brand-navy/50">
                <th className="px-4 py-3 font-medium">{t("table.product")}</th>
                <th className="px-4 py-3 font-medium">{t("table.sku")}</th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("table.avgPerDay")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("table.needed", { days: horizon })}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("table.available")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("table.cover")}
                </th>
                <th className="px-4 py-3 font-medium">{t("table.method")}</th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("table.accuracy")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const needed = row.neededByHorizon[horizon] ?? 0;
                const reorder = row.method != null && row.available < needed;
                return (
                  <tr
                    key={row.variantId}
                    className="border-b border-brand-navy/5 last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-brand-navy">
                        {row.productTitle}
                        {row.includesExplodedBundles ? (
                          <span
                            title={t("table.explodedHint")}
                            className="ml-1.5 cursor-help text-brand-navy/40"
                          >
                            ⧉
                          </span>
                        ) : null}
                      </div>
                      {row.variantTitle ? (
                        <div className="text-xs text-brand-navy/55">
                          {row.variantTitle}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-brand-navy/70">
                      {row.sku ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.method ? nf1.format(row.avgDailyUnits) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.method ? (
                        <span className="inline-flex items-center gap-2">
                          {reorder ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                              {t("table.reorderBadge")}
                            </span>
                          ) : null}
                          <span className="font-semibold tabular-nums">
                            {nf0.format(needed)}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {nf0.format(row.available)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.daysOfCover != null
                        ? t("table.coverDays", {
                            days: nf0.format(row.daysOfCover),
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.method ? (
                        <span className="rounded-full bg-brand-navy/5 px-2 py-0.5 text-[11px] font-medium text-brand-navy/70">
                          {t(`method.${row.method}`)}
                        </span>
                      ) : (
                        <span className="text-xs text-brand-navy/40">
                          {t("table.noHistory")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-brand-navy/60">
                      {row.backtestMae != null ? nf1.format(row.backtestMae) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "alert";
}) {
  return (
    <div className="rounded-md border border-brand-navy/10 bg-white px-4 py-2">
      <div className="text-[11px] uppercase tracking-wide text-brand-navy/50">
        {label}
      </div>
      <div
        className={
          tone === "alert"
            ? "text-lg font-semibold text-red-700"
            : "text-lg font-semibold text-brand-navy"
        }
      >
        {value}
      </div>
    </div>
  );
}
