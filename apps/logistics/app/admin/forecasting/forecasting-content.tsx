import { adminDb } from "@/server/firestore/admin";
import { resolveTenantShopId } from "@/server/tenant/context";
import {
  forecastsForShop,
  productsForShop,
  variantsForShop,
} from "@/server/tenant/queries";
import { tsToMillis } from "@/server/forecasting/history";
import { FORECAST_HORIZONS } from "./constants";
import { ForecastTable, type ForecastRow } from "./forecast-table";

const DEFAULT_VARIANT_TITLE = "Default Title";

export async function ForecastingContent() {
  const shopId = await resolveTenantShopId();
  const db = adminDb();
  const [variantsSnap, productsSnap, forecastsSnap] = await Promise.all([
    variantsForShop(db, shopId).get(),
    productsForShop(db, shopId).get(),
    forecastsForShop(db, shopId).get(),
  ]);

  const products = new Map<string, { title: string; isBundle: boolean }>();
  for (const d of productsSnap.docs) {
    const data = d.data();
    products.set(d.id, {
      title: String(data.title ?? ""),
      isBundle: data.is_bundle === true,
    });
  }

  const forecasts = new Map<string, Record<string, unknown>>();
  let generatedAtMs = 0;
  for (const d of forecastsSnap.docs) {
    const data = d.data();
    forecasts.set(String(data.variant_id), data);
    const ms = tsToMillis(data.generated_at);
    if (ms != null && ms > generatedAtMs) generatedAtMs = ms;
  }

  const rows: ForecastRow[] = [];
  for (const d of variantsSnap.docs) {
    const variant = d.data();
    const product = products.get(String(variant.product_id));
    if (product?.isBundle) continue; // bundle parents are virtual — no stock, no forecast

    const forecast = forecasts.get(d.id);
    const daily: number[] = Array.isArray(forecast?.daily_forecast)
      ? forecast.daily_forecast
      : [];
    const neededByHorizon: Record<number, number> = {};
    for (const h of FORECAST_HORIZONS) {
      neededByHorizon[h] = Math.ceil(
        daily.slice(0, h).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0),
      );
    }
    const avg = typeof forecast?.avg_daily_units === "number"
      ? forecast.avg_daily_units
      : 0;
    const available = typeof variant.available === "number" ? variant.available : 0;
    const variantTitle = String(variant.title ?? "");

    rows.push({
      variantId: d.id,
      productTitle: product?.title || variantTitle || d.id,
      variantTitle:
        variantTitle && variantTitle !== DEFAULT_VARIANT_TITLE
          ? variantTitle
          : null,
      sku: variant.sku ?? null,
      available,
      method: forecast
        ? (forecast.method as ForecastRow["method"])
        : null,
      avgDailyUnits: avg,
      neededByHorizon,
      daysOfCover: avg > 0 ? Math.floor(Math.max(0, available) / avg) : null,
      backtestMae:
        typeof forecast?.backtest_mae === "number" ? forecast.backtest_mae : null,
      historyDays:
        typeof forecast?.history_days === "number" ? forecast.history_days : 0,
      includesExplodedBundles: forecast?.includes_exploded_bundles === true,
    });
  }

  return (
    <ForecastTable
      rows={rows}
      generatedAtIso={generatedAtMs > 0 ? new Date(generatedAtMs).toISOString() : null}
    />
  );
}
