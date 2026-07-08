import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth/cron";
import { log } from "@/lib/logger";
import { listActiveShops } from "@/server/tenant/shop";
import { runForecastForShop } from "@/server/forecasting/run";

/**
 * Nightly demand-forecast recompute for every active shop.
 *
 * Trigger once per day from Cloud Scheduler:
 *   gcloud scheduler jobs create http forecast-nightly \
 *     --schedule "0 3 * * *" \
 *     --uri "https://your-app/api/cron/forecast?secret=$CRON_SECRET" \
 *     --http-method GET
 *
 * Idempotent — each run fully overwrites the per-variant forecast docs.
 * One failing shop doesn't block the others.
 *
 * Authentication: `CRON_SECRET` env var as `?secret=...` or
 * `Authorization: Bearer ...`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const shops = await listActiveShops();
    const results: Array<Record<string, unknown>> = [];
    for (const shop of shops) {
      try {
        const summary = await runForecastForShop(shop.id);
        results.push({ ok: true, ...summary });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error("forecast_run_failed", { shopId: shop.id, error: msg });
        results.push({ shopId: shop.id, ok: false, error: msg });
      }
    }
    return NextResponse.json({ ok: true, shops: results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("forecast_cron_crashed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
