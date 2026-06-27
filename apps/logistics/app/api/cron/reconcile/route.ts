import { NextResponse } from "next/server";
import { reconcileStuckOrders } from "@/server/reconcile/stuck-orders";
import { checkCronAuth } from "@/lib/auth/cron";
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
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const report = await reconcileStuckOrders();
    if (
      report.stuckNew > 0 ||
      report.tagDriftFixed > 0 ||
      report.expiredBatchesMarked > 0
    ) {
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
