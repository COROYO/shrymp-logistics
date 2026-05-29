import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type AllocationRun } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { enqueueAllocationRun } from "./enqueue";

/**
 * Lightweight 2-minute allocation tick.
 *
 * The realtime webhook path already enqueues a run per 2s bucket; this is a
 * cheap safety net for buckets that were dropped (Cloud Tasks hiccup, missed
 * webhook). It must stay nearly free when idle — a single existence read —
 * and must NOT pile runs onto the concurrency=1 queue during a long-running
 * backlog. So:
 *
 *   1. Skip if a *fresh* allocation run is already RUNNING (the queue is busy).
 *      A run stuck RUNNING past `STALE_RUN_MS` is presumed dead and ignored,
 *      so a crashed run can't wedge the cron forever.
 *   2. Skip if no order is in NEW (nothing to do).
 *   3. Otherwise enqueue exactly one run.
 *
 * Authentication and scheduling live in the route handler.
 */

// A RUNNING run older than this is treated as crashed, not in-progress.
const STALE_RUN_MS = 5 * 60 * 1000;

export type AllocationTickResult = {
  enqueued: boolean;
  reason: "enqueued" | "run_in_progress" | "no_new_orders";
  durationMs: number;
};

export async function allocationTick(): Promise<AllocationTickResult> {
  const t0 = Date.now();
  const db = adminDb();

  // ---- 1. Is a run already in progress? ----
  // Single equality filter → no composite index needed; freshness is checked
  // in memory so a stale RUNNING doc can't block us indefinitely.
  const runningSnap = await db
    .collection(Collections.AllocationRuns)
    .where("status", "==", "RUNNING")
    .limit(10)
    .get();
  const now = Date.now();
  const hasFreshRun = runningSnap.docs.some((d) => {
    const r = d.data() as AllocationRun;
    const startedMs = toMs(r.started_at);
    return startedMs > 0 && now - startedMs < STALE_RUN_MS;
  });
  if (hasFreshRun) {
    return { enqueued: false, reason: "run_in_progress", durationMs: Date.now() - t0 };
  }

  // ---- 2. Any NEW orders waiting? ----
  const newSnap = await db
    .collection(Collections.Orders)
    .where("internal_status", "==", "NEW")
    .limit(1)
    .get();
  if (newSnap.empty) {
    return { enqueued: false, reason: "no_new_orders", durationMs: Date.now() - t0 };
  }

  // ---- 3. Enqueue one run ----
  await enqueueAllocationRun({
    triggeredBy: "CRON",
    triggerEventId: `cron-${now}`,
  });
  log.info("allocation_cron_enqueued", { triggerEventId: `cron-${now}` });

  return { enqueued: true, reason: "enqueued", durationMs: Date.now() - t0 };
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
