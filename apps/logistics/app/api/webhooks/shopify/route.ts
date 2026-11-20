import { after } from "next/server";
import { log } from "@/lib/logger";
import { authorizeShopifyWebhook } from "@/server/shopify/webhook-auth";
import { enqueueShopifyWebhook } from "@/server/shopify/enqueue-webhook";
import { processShopifyWebhookEvent } from "@/server/shopify/process-webhook-event";
import { isSupportedTopic } from "@/server/shopify/topics";

/**
 * Shopify webhook receiver.
 *
 * Contract:
 *   - Verify HMAC (env secret first, no Firestore on the hot path).
 *   - Hand the delivery to the in-process queue (INPROCESS_JOBS=1) and
 *     ACK with 200. Shopify abandons the attempt at ~5s; the mirror runs
 *     afterwards so a burst cannot pin this request.
 *   - If the queue is off, fall back to `after()` so the event is not
 *     dropped. That path still ACKs before any database write.
 *   - Only HMAC failure, a stuck credential lookup, and a missing id
 *     return non-2xx. A 503 makes Shopify retry once the database answers.
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (e) {
    log.error("shopify_webhook_body_read_failed", { error: String(e) });
    return new Response("bad_body", { status: 400 });
  }
  const signature = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic");
  const webhookId = req.headers.get("x-shopify-webhook-id");
  const shop = req.headers.get("x-shopify-shop-domain");

  const auth = await authorizeShopifyWebhook(rawBody, signature, shop);
  if (auth === "misconfigured") {
    log.error("shopify_api_secret_missing", { topic, webhookId, shop });
    return new Response("misconfigured", { status: 200 });
  }
  if (auth === "unavailable") {
    return new Response("creds_unavailable", { status: 503 });
  }
  if (auth === "invalid") {
    log.warn("shopify_webhook_hmac_failed", { topic, shop, webhookId });
    return new Response("invalid signature", { status: 401 });
  }

  if (!webhookId) {
    log.warn("shopify_webhook_no_id", { topic, shop });
    return new Response("missing X-Shopify-Webhook-Id", { status: 400 });
  }
  if (!isSupportedTopic(topic)) {
    log.info("shopify_webhook_unsupported_topic", { topic, webhookId });
    return new Response("unsupported topic", { status: 200 });
  }
  if (!shop) {
    log.warn("shopify_webhook_no_shop", { topic, webhookId });
    return new Response("missing X-Shopify-Shop-Domain", { status: 400 });
  }

  const handoff = await enqueueShopifyWebhook({
    rawBody,
    topic,
    webhookId,
    shop,
  });
  if (handoff === "queued" || handoff === "duplicate") {
    return new Response("ok", { status: 200 });
  }

  // Queue missing or createTask failed. ACK now; mirror after the response.
  after(() =>
    processShopifyWebhookEvent({
      rawBody,
      topic,
      webhookId,
      shop,
      reprocessIncomplete: false,
    }),
  );
  return new Response("ok", { status: 200 });
}
