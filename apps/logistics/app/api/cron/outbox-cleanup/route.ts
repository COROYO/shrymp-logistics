import { NextResponse } from "next/server";
import { cleanupOutbox } from "@/server/shopify/outbox";
import { log } from "@/lib/logger";

/**
 * Scheduled outbox cleanup — keeps `shopify_outbox` from growing unbounded.
 *
 * `processRow` marks completed entries with `done_at` but never deletes them,
 * so without this sweep every order/inbound permanently adds documents
 * (storage + cost). This deletes:
 *   - completed rows older than 2 days (short debug/idempotency grace),
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
  const url = new URL(req.url);
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const fromQuery = url.searchParams.get("secret");
    const fromHeader = req.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    const provided = fromQuery ?? fromHeader ?? "";
    if (provided !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

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
