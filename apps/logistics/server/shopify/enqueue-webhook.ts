import "server-only";
import { log } from "@/lib/logger";
import { webhookBodyFitsTask } from "./webhook-task";
import { enqueueInProcessWebhook } from "./webhook-queue";

/**
 * Hand a verified webhook to the in-process queue and return immediately.
 *
 * Shopify gives up at 5s. The mirror must not run inside this request.
 * Without INPROCESS_JOBS=1 (local dev) the caller falls back to `after()`.
 * Cloud Tasks is not consulted.
 */

export type WebhookHandoff = "queued" | "duplicate" | "unavailable";

export async function enqueueShopifyWebhook(input: {
  rawBody: string;
  topic: string;
  webhookId: string;
  shop: string;
}): Promise<WebhookHandoff> {
  if (!webhookBodyFitsTask(input.rawBody)) {
    log.warn("shopify_webhook_body_too_large", {
      webhookId: input.webhookId,
      topic: input.topic,
      bytes: input.rawBody.length,
    });
    return "unavailable";
  }
  if (process.env.INPROCESS_JOBS !== "1") return "unavailable";
  return enqueueInProcessWebhook(input);
}
