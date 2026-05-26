import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { verifyShopifyHmac } from "@/server/shopify/hmac";
import { isSupportedTopic } from "@/server/shopify/topics";
import { dispatchShopifyWebhook } from "@/server/shopify/webhook-handler";

/**
 * Shopify webhook receiver.
 *
 * Contract:
 *   - Verify HMAC against `SHOPIFY_WEBHOOK_SECRET` against the raw body.
 *   - Dedupe on `X-Shopify-Webhook-Id` via a Firestore `create()` — second
 *     delivery of the same event is a no-op.
 *   - Dispatch by `X-Shopify-Topic` to the right handler.
 *   - Always respond 200 once the event is recorded, so Shopify stops retrying.
 *     Permanent rejections (HMAC fail, missing topic) get 4xx.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic");
  const webhookId = req.headers.get("x-shopify-webhook-id");
  const shop = req.headers.get("x-shopify-shop-domain");

  // Shopify Apps sign webhooks with the app's Client Secret (= API secret key).
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    log.error("shopify_api_secret_missing");
    return new Response("misconfigured", { status: 500 });
  }

  if (!verifyShopifyHmac(rawBody, signature, secret)) {
    log.warn("shopify_webhook_hmac_failed", { topic, shop });
    return new Response("invalid signature", { status: 401 });
  }

  if (!webhookId) {
    return new Response("missing X-Shopify-Webhook-Id", { status: 400 });
  }
  if (!isSupportedTopic(topic)) {
    log.info("shopify_webhook_unsupported_topic", { topic });
    return new Response("unsupported topic", { status: 202 });
  }

  // Dedup: first writer wins.
  const eventRef = adminDb()
    .collection(Collections.WebhookEvents)
    .doc(webhookId);
  try {
    await eventRef.create({
      id: webhookId,
      topic,
      received_at: FieldValue.serverTimestamp(),
      status: "RECEIVED",
    });
  } catch (e) {
    const code = (e as { code?: number | string } | null)?.code;
    if (code === 6 || code === "already-exists") {
      log.info("shopify_webhook_duplicate", { webhookId, topic });
      return new Response("duplicate", { status: 200 });
    }
    log.error("shopify_webhook_dedup_failed", {
      webhookId,
      error: String(e),
    });
    return new Response("dedup_error", { status: 500 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("invalid_json", { status: 400 });
  }

  try {
    const result = await dispatchShopifyWebhook(topic, body, webhookId);
    await eventRef.set(
      {
        status: result.kind === "error" ? "FAILED" : "PROCESSED",
        processed_at: FieldValue.serverTimestamp(),
        error: result.kind === "error" ? result.reason : undefined,
      },
      { merge: true },
    );

    if (result.kind === "error") {
      return new Response(result.reason, { status: 500 });
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    log.error("shopify_webhook_dispatch_failed", {
      webhookId,
      topic,
      error: String(e),
    });
    await eventRef
      .set(
        {
          status: "FAILED",
          processed_at: FieldValue.serverTimestamp(),
          error: String(e),
        },
        { merge: true },
      )
      .catch(() => {});
    return new Response("dispatch_failed", { status: 500 });
  }
}
