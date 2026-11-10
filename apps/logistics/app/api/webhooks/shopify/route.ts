import { after } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { verifyShopifyHmac } from "@/server/shopify/hmac";
import { loadShopAppCreds, readEnvAppCreds } from "@/server/shopify/app-credentials";
import { isSupportedTopic } from "@/server/shopify/topics";
import { dispatchShopifyWebhook } from "@/server/shopify/webhook-handler";

/**
 * Shopify webhook receiver.
 *
 * Contract:
 *   - Verify HMAC against the shop's custom-app secret (fallback: env).
 *   - Dedupe on `X-Shopify-Webhook-Id` via a Firestore `create()` — second
 *     delivery of the same event is a no-op.
 *   - ACK with 200 within Shopify's ~5s budget, then process via `after()`.
 *     Heavy work (GraphQL refetch, allocation enqueue) must NOT block the
 *     response — timeouts show as RESULT_STATUS_FAILURE in Partner logs and
 *     trigger retries that land as duplicates here.
 *   - Persistent handler failures are logged + marked FAILED for manual
 *     reprocessing; Shopify still got 200 so it stops retrying.
 *
 * Only HMAC failure and missing-id return 4xx (request is genuinely
 * malformed / not from Shopify).
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  // Read the body first. The per-shop app secret is loaded next so HMAC
  // can be checked against the custom app from onboarding.
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

  const secrets: string[] = [];
  if (shop) {
    try {
      const stored = await loadShopAppCreds(shop);
      if (stored) secrets.push(stored.apiSecret);
    } catch (e) {
      log.error("shopify_webhook_creds_lookup_failed", {
        shop,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const envCreds = readEnvAppCreds();
  if (envCreds && !secrets.includes(envCreds.apiSecret)) {
    secrets.push(envCreds.apiSecret);
  }
  if (secrets.length === 0) {
    log.error("shopify_api_secret_missing", { topic, webhookId, shop });
    // Still respond 200 to stop retries — Shopify can't fix this for us.
    return new Response("misconfigured", { status: 200 });
  }

  if (!secrets.some((secret) => verifyShopifyHmac(rawBody, signature, secret))) {
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

  // Big try/catch around persistence so any thrown error gets logged and we
  // still 200 back. Handler work runs in `after()` below.
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

    // Return 200 now; finish mirroring / allocation after the response so
    // Shopify does not time out at 5s and mark the delivery failed.
    after(async () => {
      try {
        const result = await dispatchShopifyWebhook(
          topic,
          body,
          webhookId,
          shop,
        );
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
      }
    });

    return new Response("ok", { status: 200 });
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
