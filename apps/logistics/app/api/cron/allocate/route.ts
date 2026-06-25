import { NextResponse } from "next/server";
import { allocationTick } from "@/server/allocation/cron-tick";
import { log } from "@/lib/logger";

/**
 * Scheduled allocation tick — runs an allocation only when there are NEW
 * orders waiting and no run is already in progress.
 *
 * Trigger every 2 min from Cloud Scheduler:
 *   gcloud scheduler jobs create http allocate-tick \
 *     --schedule "every 2 minutes" \
 *     --uri "https://your-app/api/cron/allocate?secret=$CRON_SECRET" \
 *     --http-method GET
 *
 * Nearly free when idle (one existence read). Distinct from
 * /api/cron/reconcile (5-min, heavier self-healing sweep).
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
    const result = await allocationTick();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("allocation_cron_crashed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
