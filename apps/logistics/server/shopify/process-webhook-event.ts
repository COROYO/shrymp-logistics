import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { dispatchShopifyWebhook } from "./webhook-handler";
import type { ShopifyTopic } from "./topics";

export type ProcessOutcome = "processed" | "duplicate" | "retry";

/**
 * Dedup on the webhook id, then mirror the event.
 *
 * `reprocessIncomplete` is for the Cloud Tasks consumer: a retry must run
 * again when the previous attempt died after the dedup doc was created.
 * Shopify's own retry hits the enqueue step instead and does not get here
 * a second time.
 */
export async function processShopifyWebhookEvent(input: {
  rawBody: string;
  topic: ShopifyTopic;
  webhookId: string;
  shop: string;
  reprocessIncomplete: boolean;
}): Promise<ProcessOutcome> {
  const { rawBody, topic, webhookId, shop, reprocessIncomplete } = input;
  const shopId = shop.trim().toLowerCase();

  try {
    const db = adminDb();
    const eventRef = db.collection(Collections.WebhookEvents).doc(webhookId);

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
        if (!reprocessIncomplete) {
          log.info("shopify_webhook_duplicate", { webhookId, topic });
          return "duplicate";
        }
        const snap = await eventRef.get();
        if (snap.data()?.status === "PROCESSED") {
          log.info("shopify_webhook_duplicate", { webhookId, topic });
          return "duplicate";
        }
      } else {
        log.error("shopify_webhook_dedup_failed", {
          webhookId,
          topic,
          error: String(e),
        });
        return "retry";
      }
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
      return "processed";
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
      return "processed";
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
      return "retry";
    }
  } catch (e) {
    log.error("shopify_webhook_fatal", {
      webhookId,
      topic,
      shop,
      error: String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    return "retry";
  }
}
