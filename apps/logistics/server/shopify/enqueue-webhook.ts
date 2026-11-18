import "server-only";
import { CloudTasksClient } from "@google-cloud/tasks";
import { log } from "@/lib/logger";
import {
  shopifyWebhookConsumerUrl,
  shopifyWebhookTaskId,
  webhookBodyFitsTask,
} from "./webhook-task";

/**
 * Hand a verified webhook to Cloud Tasks and return immediately.
 *
 * Shopify gives up at 5s. Doing the Firestore mirror inside the webhook
 * request (or in `after()`, which keeps the Cloud Run slot) piled
 * inventory_levels/update bursts onto one 512Mi instance until commits
 * hit DEADLINE_EXCEEDED and the container was OOM-killed.
 *
 * The queue name defaults to `shopify-webhooks`. A duplicate task id means
 * Shopify retried a delivery we already accepted.
 */
const CREATE_TASK_DEADLINE_MS = 2_000;
const DISPATCH_DEADLINE_SECONDS = 60;

export type WebhookHandoff = "queued" | "duplicate" | "unavailable";

let client: CloudTasksClient | null = null;

function tasksClient(): CloudTasksClient {
  if (!client) client = new CloudTasksClient();
  return client;
}

export async function enqueueShopifyWebhook(input: {
  rawBody: string;
  topic: string;
  webhookId: string;
  shop: string;
}): Promise<WebhookHandoff> {
  const projectId = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION;
  const queue = process.env.SHOPIFY_WEBHOOK_QUEUE?.trim() || "shopify-webhooks";
  const targetUrl = shopifyWebhookConsumerUrl();
  const invokerSa = process.env.ALLOCATION_INVOKER_SERVICE_ACCOUNT?.trim();
  const taskId = shopifyWebhookTaskId(input.webhookId);

  if (!projectId || !location || !targetUrl || !invokerSa || !taskId) {
    return "unavailable";
  }
  if (!webhookBodyFitsTask(input.rawBody)) {
    log.warn("shopify_webhook_body_too_large", {
      webhookId: input.webhookId,
      topic: input.topic,
      bytes: input.rawBody.length,
    });
    return "unavailable";
  }

  const tasks = tasksClient();
  const taskName = tasks.taskPath(projectId, location, queue, taskId);

  try {
    await tasks.createTask(
      {
        parent: tasks.queuePath(projectId, location, queue),
        task: {
          name: taskName,
          dispatchDeadline: { seconds: DISPATCH_DEADLINE_SECONDS },
          httpRequest: {
            httpMethod: "POST",
            url: targetUrl,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(
              JSON.stringify({
                shop: input.shop,
                topic: input.topic,
                webhookId: input.webhookId,
                rawBody: input.rawBody,
              }),
            ).toString("base64"),
            oidcToken: {
              serviceAccountEmail: invokerSa,
              audience: targetUrl,
            },
          },
        },
      },
      { timeout: CREATE_TASK_DEADLINE_MS, retry: null },
    );
    log.info("shopify_webhook_enqueued", {
      webhookId: input.webhookId,
      topic: input.topic,
      shop: input.shop,
    });
    return "queued";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already exists/i.test(msg)) {
      log.info("shopify_webhook_task_exists", {
        webhookId: input.webhookId,
        topic: input.topic,
      });
      return "duplicate";
    }
    log.error("shopify_webhook_enqueue_failed", {
      webhookId: input.webhookId,
      topic: input.topic,
      error: msg,
    });
    return "unavailable";
  }
}
