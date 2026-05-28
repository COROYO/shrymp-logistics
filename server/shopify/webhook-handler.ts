import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Order,
  type OrderInternalStatus,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { mapShopifyOrderToFirestore, type ShopifyOrderPayload } from "./mappers";
import { TOPICS, type ShopifyTopic } from "./topics";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import { fetchOrderBundleGroups } from "./bundles";

/**
 * Result of dispatching a verified, deduped webhook event.
 */
export type DispatchResult =
  | { kind: "ok"; action: string }
  | { kind: "ignored"; reason: string }
  | { kind: "error"; reason: string };

/**
 * Dispatch one Shopify webhook event by topic.
 * Assumes HMAC + dedup already happened upstream.
 */
export async function dispatchShopifyWebhook(
  topic: ShopifyTopic,
  body: unknown,
  webhookId: string,
): Promise<DispatchResult> {
  switch (topic) {
    case TOPICS.ORDERS_CREATE:
      return mirrorOrder(body as ShopifyOrderPayload, "ORDER_CREATED", webhookId);
    case TOPICS.ORDERS_UPDATED:
      return mirrorOrder(body as ShopifyOrderPayload, "ORDER_UPDATED", webhookId);
    case TOPICS.ORDERS_CANCELLED:
      return cancelOrder(body as ShopifyOrderPayload, webhookId);
    case TOPICS.INVENTORY_LEVELS_UPDATE:
      return recordInventoryDrift(body, webhookId);
    case TOPICS.APP_UNINSTALLED:
      return handleAppUninstalled(webhookId);
    default:
      return { kind: "ignored", reason: `unsupported_topic:${topic}` };
  }
}

async function mirrorOrder(
  payload: ShopifyOrderPayload,
  trigger: "ORDER_CREATED" | "ORDER_UPDATED",
  webhookId: string,
): Promise<DispatchResult> {
  if (!payload || typeof payload.id !== "number") {
    return { kind: "error", reason: "invalid_order_payload" };
  }

  const db = adminDb();
  const ref = db.collection(Collections.Orders).doc(String(payload.id));

  const snap = await ref.get();
  const prev = snap.exists ? (snap.data() as Order | undefined) : undefined;
  const previousStatus: OrderInternalStatus | null =
    prev?.internal_status ?? null;

  const doc = mapShopifyOrderToFirestore(payload, previousStatus);

  // The REST webhook payload does not carry `LineItemGroup` info, so re-fetch
  // bundle metadata via GraphQL and inline it onto each line item before
  // writing. Best-effort: if the GraphQL call fails we mirror without bundle
  // info rather than dropping the webhook entirely.
  try {
    const bundles = await fetchOrderBundleGroups(doc.shopify_gid);
    if (bundles.size > 0) {
      doc.line_items = doc.line_items.map((li) => {
        const b = bundles.get(li.id);
        return b ? { ...li, bundle: b } : li;
      });
    }
  } catch (e) {
    log.warn("bundle_enrich_failed", {
      orderId: doc.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await ref.set(
    {
      ...doc,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  await enqueueAllocationRun({
    triggeredBy: trigger,
    triggerEventId: webhookId,
  });

  log.info("shopify_order_mirrored", {
    orderId: doc.id,
    trigger,
    internalStatus: doc.internal_status,
  });
  return { kind: "ok", action: `mirrored:${trigger}` };
}

async function cancelOrder(
  payload: ShopifyOrderPayload,
  webhookId: string,
): Promise<DispatchResult> {
  if (!payload || typeof payload.id !== "number") {
    return { kind: "error", reason: "invalid_order_payload" };
  }
  const orderId = String(payload.id);
  const db = adminDb();
  const ref = db.collection(Collections.Orders).doc(orderId);

  const snap = await ref.get();
  const prevStatus = snap.exists
    ? ((snap.data() as Order | undefined)?.internal_status ?? null)
    : null;

  // Full mirror — same as create/update — so a cancellation event on an
  // order we'd missed before still lands with all fields populated.
  // mapShopifyOrderToFirestore already detects `cancelled_at` and sets
  // internal_status = "CANCELLED" regardless of `previousStatus`.
  const doc = mapShopifyOrderToFirestore(payload, prevStatus);

  // Bundle enrichment, best-effort.
  try {
    const bundles = await fetchOrderBundleGroups(doc.shopify_gid);
    if (bundles.size > 0) {
      doc.line_items = doc.line_items.map((li) => {
        const b = bundles.get(li.id);
        return b ? { ...li, bundle: b } : li;
      });
    }
  } catch (e) {
    log.warn("bundle_enrich_failed", {
      orderId: doc.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await ref.set(
    {
      ...doc,
      internal_status: "CANCELLED",
      cancelled_at: payload.cancelled_at
        ? new Date(payload.cancelled_at)
        : new Date(),
      cancel_reason: payload.cancel_reason ?? null,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  // Release any open allocations so the reserved stock comes back. We did
  // NOT release if the order was already PACKED — those products already
  // left the warehouse and the cancel becomes a return-handling problem,
  // not a stock-release problem.
  let releaseRes: { releasedAllocations: number; freedByVariant: Record<string, number> } | null = null;
  if (prevStatus !== "PACKED") {
    try {
      const { releaseOrderAllocations } = await import(
        "@/server/picking/release"
      );
      releaseRes = await releaseOrderAllocations(
        orderId,
        null,
        "order_cancelled",
      );
    } catch (e) {
      log.warn("release_on_cancel_failed", {
        orderId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Push the freed inventory back to Shopify so the storefront reflects it.
    if (releaseRes && releaseRes.releasedAllocations > 0) {
      try {
        const { queueInventoryPush } = await import(
          "@/server/inventory/sync-to-shopify"
        );
        const { processOutbox } = await import("@/server/shopify/outbox");
        for (const variantId of Object.keys(releaseRes.freedByVariant)) {
          await queueInventoryPush(
            variantId,
            "cancellation",
            `monolith-lager://order/${orderId}/cancelled`,
          );
        }
        await processOutbox(20);
      } catch (e) {
        log.warn("inventory_push_on_cancel_failed", {
          orderId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // Re-run allocation: freed stock may unblock STOP orders waiting for
  // exactly those variants.
  await enqueueAllocationRun({
    triggeredBy: "ORDER_CANCELLED",
    triggerEventId: webhookId,
  });
  log.info("shopify_order_cancelled", {
    orderId,
    prevStatus,
    released: releaseRes?.releasedAllocations ?? 0,
    reason: payload.cancel_reason ?? null,
  });
  return { kind: "ok", action: "cancelled" };
}

async function recordInventoryDrift(
  body: unknown,
  webhookId: string,
): Promise<DispatchResult> {
  // We are the source of truth, so any external change is treated as drift.
  // We don't auto-overwrite — admin must reconcile manually (or via M9 job).
  log.warn("inventory_drift_detected", { webhookId, body });
  return { kind: "ok", action: "drift_logged" };
}

async function handleAppUninstalled(
  webhookId: string,
): Promise<DispatchResult> {
  log.warn("shopify_app_uninstalled", { webhookId });
  // Future: clear `config/shopify_meta`, mark tokens invalid, etc.
  return { kind: "ok", action: "uninstall_noted" };
}
