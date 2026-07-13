import { NextResponse } from "next/server";
import { processOutbox } from "@/server/shopify/outbox";
import { checkCronAuth } from "@/lib/auth/cron";
import { log } from "@/lib/logger";

/**
 * Scheduled Shopify outbox drain — safety net for rows that missed inline drains
 * (serverless container killed, Shopify outage, etc.).
 *
 * Trigger every 5 min from Cloud Scheduler:
 *   gcloud scheduler jobs create http outbox-retry \
 *     --location=europe-west3 \
 *     --schedule="every 5 minutes" \
 *     --uri="https://your-app/api/cron/outbox-retry" \
 *     --http-method=GET \
 *     --headers="Authorization=Bearer $CRON_SECRET"
 *
 * Cheap when idle (empty due-query). Idempotent via per-row claim transactions.
 *
 * Authentication: `CRON_SECRET` env var as `?secret=...` or
 * `Authorization: Bearer ...`. Optional `?limit=` override (default 100).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 500)
      : 100;

  try {
    const result = await processOutbox(limit);
    if (result.processed > 0 || result.failed > 0) {
      log.info("outbox_retry_drained", { limit, ...result });
    }
    return NextResponse.json({ ok: true, limit, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("outbox_retry_crashed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
