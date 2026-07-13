import { NextResponse } from "next/server";
import { cleanupOutbox } from "@/server/shopify/outbox";
import { checkCronAuth } from "@/lib/auth/cron";
import { log } from "@/lib/logger";

/**
 * Scheduled outbox cleanup — keeps `shopify_outbox` from growing unbounded.
 *
 * Successful rows are deleted immediately by `processRow`. This sweep removes
 * legacy `done_at` backlog and abandoned failures:
 *   - completed rows older than 2 days (legacy `done_at` only),
 *   - any row older than 14 days (abandoned/stuck failures).
 *
 * Trigger once a day from Cloud Scheduler:
 *   gcloud scheduler jobs create http outbox-cleanup \
 *     --schedule "0 3 * * *" \
 *     --uri "https://your-app/api/cron/outbox-cleanup?secret=$CRON_SECRET" \
 *     --http-method GET --location europe-west3
 *
 * Cheap + idempotent: when nothing is due the indexed queries return empty.
 * For a large existing backlog, call it a few times (each run deletes up to
 * 10k rows) until `deleted*` hits 0.
 *
 * Authentication: `CRON_SECRET` env var as `?secret=...` or
 * `Authorization: Bearer ...`. Optional `?doneDays=` / `?staleDays=` overrides.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const doneDays = Number(url.searchParams.get("doneDays"));
  const staleDays = Number(url.searchParams.get("staleDays"));

  try {
    const result = await cleanupOutbox({
      doneRetentionDays: Number.isFinite(doneDays) && doneDays >= 0 ? doneDays : undefined,
      staleRetentionDays:
        Number.isFinite(staleDays) && staleDays >= 0 ? staleDays : undefined,
    });
    if (result.deletedDone > 0 || result.deletedStale > 0) {
      log.info("outbox_cleanup_swept", result);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("outbox_cleanup_crashed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
