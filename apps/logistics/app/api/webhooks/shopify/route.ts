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
 *   - Verify HMAC against `SHOPIFY_API_SECRET` against the raw body.
 *   - Dedupe on `X-Shopify-Webhook-Id` via a Firestore `create()` — second
 *     delivery of the same event is a no-op.
 *   - Dispatch by `X-Shopify-Topic` to the right handler.
 *   - Always respond 200 once we have ANY view of the event (recorded or
 *     not), so Shopify stops retrying. Persistent failures are app bugs,
 *     not Shopify's — they get logged and persisted as FAILED for manual
 *     reprocessing.
 *
 * Only HMAC failure and missing-id return 4xx (request is genuinely
 * malformed / not from Shopify).
 */
export async function POST(req: Request) {
  // Read everything BEFORE touching Firestore / env. Cheap, can't throw.
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

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    log.error("shopify_api_secret_missing", { topic, webhookId, shop });
    // Still respond 200 to stop retries — Shopify can't fix this for us.
    return new Response("misconfigured", { status: 200 });
  }

  if (!verifyShopifyHmac(rawBody, signature, secret)) {
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

  const shopId = shop.trim().toLowerCase();

  // Big try/catch around EVERYTHING below so any thrown error gets persisted
  // and we always 200 back. Without this, an `adminDb()` init crash or an
  // unhandled exception in `dispatchShopifyWebhook` ends in a 500 with no
  // webhook_events row — invisible to us, and Shopify retries 19× before
  // giving up.
  try {
    const db = adminDb();
    const eventRef = db.collection(Collections.WebhookEvents).doc(webhookId);

    // Dedup: first writer wins.
    try {
      await eventRef.create({
        id: webhookId,
        shop_id: shopId,
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
      // Persist the failure on the doc anyway (idempotent set with merge).
      await eventRef
        .set(
          {
            id: webhookId,
            topic,
            received_at: FieldValue.serverTimestamp(),
            status: "FAILED",
            error: `dedup_error: ${String(e)}`,
          },
          { merge: true },
        )
        .catch(() => {});
      log.error("shopify_webhook_dedup_failed", {
        webhookId,
        topic,
        error: String(e),
      });
      return new Response("ok (dedup-error logged)", { status: 200 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      await eventRef
        .set(
          { status: "FAILED", error: `invalid_json: ${String(e)}` },
          { merge: true },
        )
        .catch(() => {});
      return new Response("ok (invalid-json logged)", { status: 200 });
    }

    try {
      const result = await dispatchShopifyWebhook(topic, body, webhookId, shop);
      const update: Record<string, unknown> = {
        status: result.kind === "error" ? "FAILED" : "PROCESSED",
        processed_at: FieldValue.serverTimestamp(),
      };
      if (result.kind === "error") update.error = result.reason;
      await eventRef.set(update, { merge: true });

      if (result.kind === "error") {
        log.error("shopify_webhook_dispatch_app_error", {
          webhookId,
          topic,
          reason: result.reason,
        });
      }
      return new Response("ok", { status: 200 });
    } catch (e) {
      log.error("shopify_webhook_dispatch_failed", {
        webhookId,
        topic,
        error: String(e),
        stack: e instanceof Error ? e.stack : undefined,
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
      // Persistent failure — don't make Shopify retry, we'll reprocess
      // manually after the fix.
      return new Response("ok (dispatch-error logged)", { status: 200 });
    }
  } catch (e) {
    // Catastrophic: even `adminDb()` failed (env missing, SA JSON parse error,
    // etc). Log + 200 so Shopify stops retrying. Without persistence we still
    // get the alert in our app logs.
    log.error("shopify_webhook_fatal", {
      webhookId,
      topic,
      shop,
      error: String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    return new Response("ok (fatal logged)", { status: 200 });
  }
}
