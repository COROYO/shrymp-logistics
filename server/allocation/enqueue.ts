import "server-only";
import { log } from "@/lib/logger";

/**
 * Enqueue an allocation run via Cloud Tasks.
 *
 * The queue is configured with `maxConcurrentDispatches: 1` so the consumer
 * (HTTP handler at `/api/internal/allocation/run`) serializes runs naturally.
 * A 2-second time bucket in the task name dedupes burst triggers.
 *
 * Falls back to an *inline* synchronous run when Cloud Tasks env vars are
 * not configured (local dev / tests).
 */

export type AllocationTrigger =
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "ORDER_CANCELLED"
  | "INBOUND"
  | "PACKING_DONE"
  | "MANUAL";

export type EnqueueOptions = {
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
    // Lazy-import to avoid pulling Firestore in the rare path where this is unused.
    const { runAllocationInFirestore } = await import("./run");
    void runAllocationInFirestore(opts).catch((e) =>
      log.error("inline_allocation_failed", { error: String(e) }),
    );
    return { enqueued: false, mode: "inline" };
  }

  try {
    const { CloudTasksClient } = await import("@google-cloud/tasks");
    const client = new CloudTasksClient();

    const bucket = Math.floor(Date.now() / 2000);
    const taskName = client.taskPath(
      projectId,
      location,
      queue,
      `allocation-${bucket}`,
    );

    await client.createTask({
      parent: client.queuePath(projectId, location, queue),
      task: {
        name: taskName,
        httpRequest: {
          httpMethod: "POST",
          url: targetUrl,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
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
    const { runAllocationInFirestore } = await import("./run");
    void runAllocationInFirestore(opts).catch((err) =>
      log.error("inline_allocation_failed", { error: String(err) }),
    );
    return { enqueued: false, mode: "inline" };
  }
}
