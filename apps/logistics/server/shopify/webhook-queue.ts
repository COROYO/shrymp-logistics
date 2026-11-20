import "server-only";
import { log } from "@/lib/logger";
import { processShopifyWebhookEvent } from "./process-webhook-event";
import type { ShopifyTopic } from "./topics";

/**
 * In-process stand-in for the shopify-webhooks Cloud Tasks queue.
 * Concurrency 4, dedup by webhook id, 8 attempts, backoff 10s..300s.
 * Started on the first enqueue. One replica only.
 */

const CONCURRENCY = 4;
const MAX_ATTEMPTS = 8;

type Job = {
  rawBody: string;
  topic: string;
  webhookId: string;
  shop: string;
  attempt: number;
};

const known = new Set<string>();
const queue: Job[] = [];
let active = 0;

function backoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** attempt, 300_000);
}

function pump(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    active += 1;
    void run(job).finally(() => {
      active -= 1;
      pump();
    });
  }
}

async function run(job: Job): Promise<void> {
  let retry = false;
  try {
    const outcome = await processShopifyWebhookEvent({
      rawBody: job.rawBody,
      topic: job.topic as ShopifyTopic,
      webhookId: job.webhookId,
      shop: job.shop,
      reprocessIncomplete: job.attempt > 0,
    });
    retry = outcome === "retry" && job.attempt + 1 < MAX_ATTEMPTS;
  } catch (error) {
    log.error("shopify_webhook_worker_failed", {
      webhookId: job.webhookId,
      topic: job.topic,
      attempt: job.attempt,
      error: String(error),
    });
    retry = job.attempt + 1 < MAX_ATTEMPTS;
  }

  if (retry) {
    const timer = setTimeout(() => {
      queue.push({ ...job, attempt: job.attempt + 1 });
      pump();
    }, backoffMs(job.attempt));
    timer.unref?.();
    return;
  }
  known.delete(job.webhookId);
}

export function enqueueInProcessWebhook(input: {
  rawBody: string;
  topic: string;
  webhookId: string;
  shop: string;
}): "queued" | "duplicate" {
  if (known.has(input.webhookId)) return "duplicate";
  known.add(input.webhookId);
  queue.push({ ...input, attempt: 0 });
  pump();
  return "queued";
}
