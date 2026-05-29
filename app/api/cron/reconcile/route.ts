import { NextResponse } from "next/server";
import { reconcileStuckOrders } from "@/server/reconcile/stuck-orders";
import { log } from "@/lib/logger";

/**
 * Scheduled reconciliation — catches anything realtime missed.
 *
 * Trigger every 5 min from Cloud Scheduler:
 *   gcloud scheduler jobs create http reconcile-orders \
 *     --schedule "every 5 minutes" \
 *     --uri "https://your-app/api/cron/reconcile?secret=$CRON_SECRET" \
 *     --http-method GET
 *
 * What it does:
 *   - NEW orders older than 60s → force a synchronous allocation run.
 *   - SHIP/STOP/PACKED orders missing their expected LAGER_* tag → enqueue
 *     corrective outbox rows + drain.
 *
 * Idempotent. Cheap. Logs warnings whenever it fixes something so the gap
 * shows up in monitoring.
 *
 * Authentication: `CRON_SECRET` env var as `?secret=...` or
 * `Authorization: Bearer ...`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get("secret");
    const fromHeader = req.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    const provided = fromQuery ?? fromHeader ?? "";
    if (provided !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const report = await reconcileStuckOrders();
    if (report.stuckNew > 0 || report.tagDriftFixed > 0) {
      log.warn("reconcile_repaired", report);
    } else {
      log.info("reconcile_clean", report);
    }
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("reconcile_crashed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
