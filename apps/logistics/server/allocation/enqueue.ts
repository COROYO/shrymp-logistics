import "server-only";
import { log } from "@/lib/logger";
import type { AllocationTrigger } from "@/server/firestore/schema";
import { runWithTenantAsync } from "@/server/tenant/context";
import { runAllocationInFirestore } from "./run";

/**
 * Schedule an allocation run in this process.
 *
 * One replica only. A 2s bucket plus a short delay lets every webhook in the
 * window mirror its order before the run reads. A second enqueue in the same
 * bucket is a no-op. Runs for one shop never overlap.
 */
const BUCKET_MS = 2000;
const SCHEDULE_BUFFER_MS = 500;

const buckets = new Set<string>();
const tails = new Map<string, Promise<void>>();

export type EnqueueOptions = {
  shopId: string;
  triggeredBy: AllocationTrigger;
  triggerEventId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export async function enqueueAllocationRun(
  opts: EnqueueOptions,
): Promise<{ enqueued: boolean; mode: "inline" | "skipped"; ref?: string }> {
  const now = Date.now();
  const bucketStart = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const bucketId = bucketStart / BUCKET_MS;
  const key = `${opts.shopId}:${bucketId}`;
  if (buckets.has(key)) {
    log.info("allocation_task_already_queued", opts);
    return { enqueued: false, mode: "skipped" };
  }
  buckets.add(key);
  const fireAt = bucketStart + BUCKET_MS + SCHEDULE_BUFFER_MS;

  const prev = tails.get(opts.shopId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    try {
      const wait = Math.max(0, fireAt - Date.now());
      if (wait > 0) await sleep(wait);
      await runWithTenantAsync(opts.shopId, () => runAllocationInFirestore(opts));
    } catch (error) {
      log.error("inline_allocation_failed", { error: String(error) });
    } finally {
      buckets.delete(key);
    }
  });
  tails.set(opts.shopId, next);

  log.info("allocation_scheduled", { ...opts, delayMs: Math.max(0, fireAt - now) });
  return { enqueued: true, mode: "inline", ref: key };
}
