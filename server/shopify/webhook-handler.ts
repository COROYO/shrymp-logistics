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
  const db = adminDb();
  const ref = db.collection(Collections.Orders).doc(String(payload.id));
  await ref.set(
    {
      internal_status: "CANCELLED",
      shopify_fulfillment_status: payload.fulfillment_status ?? null,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // M9 reconcile or future cancellation flow will release reservations.
  await enqueueAllocationRun({
    triggeredBy: "ORDER_CANCELLED",
    triggerEventId: webhookId,
  });
  log.info("shopify_order_cancelled", { orderId: String(payload.id) });
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
