import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type AllocationRun } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { enqueueAllocationRun } from "./enqueue";
import { listActiveShops } from "@/server/tenant/shop";
import { ordersForShop } from "@/server/tenant/queries";

/**
 * Lightweight 2-minute allocation tick — runs per active shop.
 *
 * The realtime webhook path already enqueues a run per 2s bucket; this is a
 * cheap safety net for buckets that were dropped (Cloud Tasks hiccup, missed
 * webhook). It must stay nearly free when idle — a single existence read per
 * shop — and must NOT pile runs onto the concurrency=1 queue during a long-running
 * backlog.
 */

const STALE_RUN_MS = 5 * 60 * 1000;

export type AllocationTickResult = {
  enqueued: boolean;
  reason: "enqueued" | "run_in_progress" | "no_new_orders";
  durationMs: number;
  shopsChecked: number;
};

export async function allocationTick(): Promise<AllocationTickResult> {
  const t0 = Date.now();
  const db = adminDb();
  const shops = await listActiveShops();
  let enqueuedAny = false;

  for (const shop of shops) {
    const shopId = shop.id;
    const runningSnap = await db
      .collection(Collections.AllocationRuns)
      .where("shop_id", "==", shopId)
      .where("status", "==", "RUNNING")
      .limit(10)
      .get();
    const now = Date.now();
    const hasFreshRun = runningSnap.docs.some((d) => {
      const r = d.data() as AllocationRun;
      const startedMs = toMs(r.started_at);
      return startedMs > 0 && now - startedMs < STALE_RUN_MS;
    });
    if (hasFreshRun) continue;

    const newSnap = await ordersForShop(db, shopId)
      .where("internal_status", "==", "NEW")
      .limit(1)
      .get();
    if (newSnap.empty) continue;

    await enqueueAllocationRun({
      shopId,
      triggeredBy: "CRON",
      triggerEventId: `cron-${shopId}-${now}`,
    });
    log.info("allocation_cron_enqueued", {
      shopId,
      triggerEventId: `cron-${shopId}-${now}`,
    });
    enqueuedAny = true;
  }

  return {
    enqueued: enqueuedAny,
    reason: enqueuedAny ? "enqueued" : "no_new_orders",
    durationMs: Date.now() - t0,
    shopsChecked: shops.length,
  };
}

function toMs(ts: unknown): number {
  if (ts == null) return 0;
  if (ts instanceof Timestamp) return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "string") return new Date(ts).getTime();
  if (typeof ts === "object") {
    const o = ts as { toMillis?: () => number; seconds?: number };
    if (typeof o.toMillis === "function") return o.toMillis();
    if (typeof o.seconds === "number") return o.seconds * 1000;
  }
  return 0;
}
