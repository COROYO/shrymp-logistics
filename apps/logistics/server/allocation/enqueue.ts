import "server-only";
import { CloudTasksClient } from "@google-cloud/tasks";
import { log } from "@/lib/logger";
import type { AllocationTrigger } from "@/server/firestore/schema";
import { runWithTenantAsync } from "@/server/tenant/context";
import { runAllocationInFirestore } from "./run";

/**
 * Enqueue an allocation run via Cloud Tasks.
 *
 * The queue is configured with `maxConcurrentDispatches: 1` so the consumer
 * (HTTP handler at `/api/internal/allocation/run`) serializes runs naturally.
 *
 * Bucketing strategy
 * ------------------
 * We coalesce bursts with a 2-second time bucket in the task name. The task
 * is **scheduled to fire at the END of its bucket** (`scheduleTime` = bucket
 * end + small buffer), not immediately. That way every webhook that arrives
 * within the same 2s window mirrors its order BEFORE the run reads Firestore,
 * and the dedupe (`ALREADY_EXISTS`) is harmless — the trailing webhook just
 * piggy-backs on the still-pending task.
 *
 * Without the schedule delay we had a silent gap: webhook A enqueued bucket
 * B's task → Cloud Tasks fired it immediately → snapshot taken → webhook A'
 * (same bucket) arrived, tried to enqueue, got `ALREADY_EXISTS`, was dropped,
 * never ran. Orders inserted mid-bucket fell through and stayed in NEW with
 * no tag push.
 *
 * Falls back to an *inline* synchronous run when Cloud Tasks env vars are
 * not configured (local dev / tests).
 */
const BUCKET_MS = 2000;
// How long after the bucket ends the task fires. Has to be > Firestore's
// commit-to-read visibility (~tens of ms). 500ms is comfortably more than
// enough and barely slows perceived latency.
const SCHEDULE_BUFFER_MS = 500;

export type EnqueueOptions = {
  shopId: string;
  triggeredBy: AllocationTrigger;
  triggerEventId?: string;
};

export async function enqueueAllocationRun(
  opts: EnqueueOptions,
): Promise<{ enqueued: boolean; mode: "cloud_tasks" | "inline" | "skipped"; ref?: string }> {
  const projectId = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION;
  const queue = process.env.ALLOCATION_QUEUE;
  const targetUrl = process.env.ALLOCATION_TARGET_URL;
  const invokerSa = process.env.ALLOCATION_INVOKER_SERVICE_ACCOUNT;

  if (!projectId || !location || !queue || !targetUrl) {
    log.info("allocation_enqueue_inline", opts);
    void runWithTenantAsync(opts.shopId, () =>
      runAllocationInFirestore(opts),
    ).catch((e) => log.error("inline_allocation_failed", { error: String(e) }));
    return { enqueued: false, mode: "inline" };
  }

  try {
    const client = new CloudTasksClient();

    const now = Date.now();
    const bucketStart = Math.floor(now / BUCKET_MS) * BUCKET_MS;
    const bucketId = bucketStart / BUCKET_MS;
    const fireAtMs = bucketStart + BUCKET_MS + SCHEDULE_BUFFER_MS;
    const shopKey = opts.shopId.replace(/\./g, "_");
    const taskName = client.taskPath(
      projectId,
      location,
      queue,
      `allocation-${shopKey}-${bucketId}`,
    );

    await client.createTask({
      parent: client.queuePath(projectId, location, queue),
      task: {
        name: taskName,
        scheduleTime: {
          seconds: Math.floor(fireAtMs / 1000),
          nanos: (fireAtMs % 1000) * 1_000_000,
        },
        httpRequest: {
          httpMethod: "POST",
          url: targetUrl,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              shopId: opts.shopId,
              triggeredBy: opts.triggeredBy,
              triggerEventId: opts.triggerEventId,
            }),
          ).toString("base64"),
          ...(invokerSa
            ? { oidcToken: { serviceAccountEmail: invokerSa } }
            : {}),
        },
      },
    });

    log.info("allocation_enqueued", { ...opts, taskName });
    return { enqueued: true, mode: "cloud_tasks", ref: taskName };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Duplicate task in same 2s bucket → safe to ignore.
    if (/already exists/i.test(msg)) {
      log.info("allocation_task_already_queued", opts);
      return { enqueued: false, mode: "skipped" };
    }
    log.error("allocation_enqueue_failed", { error: msg });
    // Don't crash callers — fall back to inline.
    void runWithTenantAsync(opts.shopId, () =>
      runAllocationInFirestore(opts),
    ).catch((err) =>
      log.error("inline_allocation_failed", { error: String(err) }),
    );
    return { enqueued: false, mode: "inline" };
  }
}
