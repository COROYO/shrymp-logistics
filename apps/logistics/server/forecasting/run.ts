import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Forecast } from "@/server/firestore/schema";
import {
  ordersForShop,
  productsForShop,
  variantsForShop,
} from "@/server/tenant/queries";
import { normalizeShopId } from "@/server/tenant/id";
import { log } from "@/lib/logger";
import {
  buildDemandHistory,
  toDenseSeries,
  type HistoryLineItem,
  type HistoryOrder,
} from "./history";
import { forecastSeries, FORECAST_HORIZON_DAYS } from "./engine";

const DAY_MS = 86_400_000;
/** 24 months of history — enough for weekly seasonality plus trend. */
const DEFAULT_WINDOW_DAYS = 730;
/** Firestore batch limit is 500 ops; stay under it. */
const WRITE_CHUNK = 400;

export type ForecastRunSummary = {
  shopId: string;
  ordersScanned: number;
  variantsTotal: number;
  forecastsWritten: number;
  bundleParentsSkipped: number;
  noHistory: number;
  explodedVariants: number;
  windowDays: number;
  tookMs: number;
};

/**
 * Recompute demand forecasts for every sellable variant of a shop.
 *
 * One orders scan feeds all variants (no per-variant queries). Bundle
 * parents are virtual (no stock) and get no forecast — their demand lives
 * on the components, including exploded legacy bundle sales (see
 * `server/forecasting/history.ts`).
 */
export async function runForecastForShop(
  shopId: string,
  opts?: { windowDays?: number; horizonDays?: number; nowMs?: number },
): Promise<ForecastRunSummary> {
  const startedAt = Date.now();
  const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS;
  const horizonDays = opts?.horizonDays ?? FORECAST_HORIZON_DAYS;
  const nowMs = opts?.nowMs ?? Date.now();
  const db = adminDb();
  const normalizedShopId = normalizeShopId(shopId);

  const [ordersSnap, variantsSnap, productsSnap] = await Promise.all([
    ordersForShop(db, shopId)
      .where(
        "created_at_shopify",
        ">=",
        Timestamp.fromMillis(nowMs - windowDays * DAY_MS),
      )
      .get(),
    variantsForShop(db, shopId).get(),
    productsForShop(db, shopId).get(),
  ]);

  const orders: HistoryOrder[] = ordersSnap.docs.map((d) => {
    const data = d.data();
    const lineItems = Array.isArray(data.line_items) ? data.line_items : [];
    return {
      internal_status: String(data.internal_status ?? "NEW"),
      created_at_shopify: data.created_at_shopify,
      line_items: lineItems
        .filter((li) => li && typeof li.variant_id === "string")
        .map(
          (li): HistoryLineItem => ({
            variant_id: li.variant_id,
            qty: typeof li.qty === "number" ? li.qty : 0,
            bundle:
              li.bundle && typeof li.bundle.group_id === "string"
                ? {
                    group_id: li.bundle.group_id,
                    variant_id: li.bundle.variant_id ?? null,
                    quantity:
                      typeof li.bundle.quantity === "number"
                        ? li.bundle.quantity
                        : 1,
                  }
                : null,
          }),
        ),
    };
  });

  const bundleProductIds = new Set<string>();
  for (const d of productsSnap.docs) {
    if (d.data().is_bundle === true) bundleProductIds.add(d.id);
  }

  const history = buildDemandHistory({ orders, nowMs, windowDays });

  const summary: ForecastRunSummary = {
    shopId: normalizedShopId,
    ordersScanned: history.ordersCounted,
    variantsTotal: variantsSnap.size,
    forecastsWritten: 0,
    bundleParentsSkipped: 0,
    noHistory: 0,
    explodedVariants: history.explodedVariants.size,
    windowDays,
    tookMs: 0,
  };

  const docs: Array<{ id: string; data: Omit<Forecast, "generated_at"> }> = [];
  for (const variantDoc of variantsSnap.docs) {
    const variant = variantDoc.data();
    if (bundleProductIds.has(String(variant.product_id))) {
      summary.bundleParentsSkipped++;
      continue;
    }
    const demand = history.demandByVariant.get(variantDoc.id);
    const days = demand ? toDenseSeries(demand, history.endDayNum) : null;
    if (!days) {
      summary.noHistory++;
      continue;
    }
    const result = forecastSeries(days, horizonDays);
    docs.push({
      id: `${normalizedShopId}_${variantDoc.id}`,
      data: {
        id: `${normalizedShopId}_${variantDoc.id}`,
        shop_id: normalizedShopId,
        variant_id: variantDoc.id,
        method: result.method,
        horizon_days: horizonDays,
        daily_forecast: result.dailyForecast,
        sigma_daily: result.sigmaDaily,
        backtest_mae: result.backtestMae,
        avg_daily_units: result.avgDailyUnits,
        history_days: result.historyDays,
        nonzero_days: result.nonzeroDays,
        history_total_units: result.historyTotalUnits,
        includes_exploded_bundles: history.explodedVariants.has(variantDoc.id),
      },
    });
  }

  for (let i = 0; i < docs.length; i += WRITE_CHUNK) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + WRITE_CHUNK)) {
      batch.set(db.collection(Collections.Forecasts).doc(doc.id), {
        ...doc.data,
        generated_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  summary.forecastsWritten = docs.length;
  summary.tookMs = Date.now() - startedAt;

  log.info("forecast_run_done", summary);
  return summary;
}
