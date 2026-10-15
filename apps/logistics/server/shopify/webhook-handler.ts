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
import { mirrorInternalStatus } from "@/server/allocation/status-guard";
import { fetchOrderLineItems } from "./bundles";
import { normalizeShopId } from "@/server/tenant/id";
import { runWithTenantAsync } from "@/server/tenant/context";
import { markShopUninstalled } from "@/server/tenant/shop";
import { mergeAutomationLineItems } from "@/server/automation/order-tags";
import { dispatchAutomationEvent } from "@/server/automation/dispatch";

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
  shopDomain: string,
): Promise<DispatchResult> {
  const shopId = normalizeShopId(shopDomain);
  return runWithTenantAsync(shopId, async () => {
    switch (topic) {
      case TOPICS.ORDERS_CREATE:
        return mirrorOrder(
          shopId,
          body as ShopifyOrderPayload,
          "ORDER_CREATED",
          webhookId,
        );
      case TOPICS.ORDERS_UPDATED:
      case TOPICS.ORDERS_EDITED:
        return mirrorOrder(
          shopId,
          body as ShopifyOrderPayload,
          "ORDER_UPDATED",
          webhookId,
        );
      case TOPICS.ORDERS_CANCELLED:
        return cancelOrder(shopId, body as ShopifyOrderPayload, webhookId);
      case TOPICS.INVENTORY_LEVELS_UPDATE:
        return applyInventoryLevelsUpdate(shopId, body, webhookId);
      case TOPICS.APP_UNINSTALLED:
        return handleAppUninstalled(shopId, webhookId);
      default:
        return { kind: "ignored", reason: `unsupported_topic:${topic}` };
    }
  });
}

async function mirrorOrder(
  shopId: string,
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

  const doc = mapShopifyOrderToFirestore(
    payload,
    shopId,
    previousStatus,
    prev?.lager_tag_synced ?? null,
  );

  // Replace line_items with the canonical GraphQL view. The REST webhook
  // payload's `line_items` array keeps entries for items that were REMOVED
  // via Shopify's Order Editing API (their `current_quantity` becomes 0 but
  // `quantity` stays). Trusting it leads to ghost items in the order.
  // GraphQL `quantity` reflects the current state and also carries
  // `lineItemGroup` (bundle info), so this single fetch covers both
  // correctness and bundle enrichment.
  //
  // Best-effort: if GraphQL fails we fall back to the (potentially stale)
  // mapper output rather than dropping the webhook entirely.
  try {
    const fresh = await fetchOrderLineItems(doc.shopify_gid, shopId);
    if (fresh && fresh.length > 0) {
      doc.line_items = fresh;
    } else if (fresh) {
      // GraphQL returned zero items — possible if every item was removed in
      // an edit (rare). Honour that.
      doc.line_items = [];
    }
    // If `fresh === null` (order not found in GraphQL — race condition with
    // a freshly-created order, or a cancelled+deleted one), keep mapper output.
  } catch (e) {
    log.warn("order_lineitems_refetch_failed", {
      orderId: doc.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Preserve local automation free-gifts across Shopify mirrors.
  doc.line_items = mergeAutomationLineItems(doc.line_items, prev?.line_items);

  // Atomic, status-preserving write. `internal_status` is owned by OUR state
  // machine (allocation / picking / fulfillment) — a mirror must NEVER change an
  // existing order's status. We re-read the CURRENT status INSIDE the txn and
  // keep it (only a brand-new order becomes NEW; a Shopify cancellation moves
  // forward to CANCELLED). This makes it impossible for a mirror to revert a
  // PACKED/PICKING order back to SHIP — the root cause of the double-deduction.
  // merge:true preserves our internal fields (packed_at, externally_fulfilled,
  // tracking, …) that the Shopify payload doesn't carry.
  const isCancelled = !!payload.cancelled_at;
  const statusBefore = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const before: OrderInternalStatus | null = cur.exists
      ? ((cur.data() as Order).internal_status ?? null)
      : null;
    const curData = cur.exists ? (cur.data() as Order) : undefined;
    tx.set(
      ref,
      {
        ...doc,
        // Keep local gifts if another writer raced between read and txn.
        line_items: mergeAutomationLineItems(
          doc.line_items,
          curData?.line_items,
        ),
        internal_status: mirrorInternalStatus(before, isCancelled),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return before;
  });

  // If Shopify is reporting the order as fulfilled (someone clicked "Fulfill"
  // inside Shopify Admin, or another integration created the fulfillment),
  // mirror that state on our side: consume the FEFO-allocated stock, swap
  // the status tags, push the new inventory level when write-back is on.
  // We do NOT enqueue an allocation run in that branch — the external-fulfill
  // helper queues its own. `wasPacked` uses the FRESH in-txn status.
  const fulfillmentStatus = (doc.shopify_fulfillment_status ?? "").toLowerCase();
  const isFulfilled =
    fulfillmentStatus === "fulfilled" || fulfillmentStatus === "partial";
  const wasPacked = statusBefore === "PACKED";

  if (isFulfilled && !wasPacked) {
    try {
      const { applyExternalFulfillment } = await import(
        "@/server/picking/external-fulfillment"
      );
      const res = await applyExternalFulfillment(doc.id);
      log.info("shopify_external_fulfillment", {
        orderId: doc.id,
        applied: res.applied,
        reason: res.reason,
      });
      return { kind: "ok", action: `external_fulfilled:${res.applied}` };
    } catch (e) {
      log.warn("external_fulfillment_failed", {
        orderId: doc.id,
        error: e instanceof Error ? e.message : String(e),
      });
      // Fall through to normal allocation enqueue so the order at least
      // stays on the queue.
    }
  }

  // Automation before allocation so free gifts / holds / priority land first.
  // First-seen orders (also via ORDERS_UPDATED if create webhook was missed)
  // get ORDER_IMPORTED; paid transitions get ORDER_PAID.
  const paidNow =
    (doc.shopify_financial_status ?? "").toLowerCase() === "paid";
  const paidBefore =
    (prev?.shopify_financial_status ?? "").toLowerCase() === "paid";
  if (statusBefore === null) {
    await dispatchAutomationEvent({
      shopId,
      trigger: "ORDER_IMPORTED",
      orderId: doc.id,
    });
    if (paidNow) {
      await dispatchAutomationEvent({
        shopId,
        trigger: "ORDER_PAID",
        orderId: doc.id,
      });
    }
  } else if (paidNow && !paidBefore) {
    await dispatchAutomationEvent({
      shopId,
      trigger: "ORDER_PAID",
      orderId: doc.id,
    });
  }

  await enqueueAllocationRun({
    shopId,
    triggeredBy: trigger,
    triggerEventId: webhookId,
  });

  log.info("shopify_order_mirrored", {
    orderId: doc.id,
    trigger,
    internalStatus: mirrorInternalStatus(statusBefore, isCancelled),
  });
  return { kind: "ok", action: `mirrored:${trigger}` };
}

async function cancelOrder(
  shopId: string,
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
  const prevData = snap.exists ? (snap.data() as Order | undefined) : undefined;
  const prevStatus = prevData?.internal_status ?? null;

  // Full mirror — same as create/update — so a cancellation event on an
  // order we'd missed before still lands with all fields populated.
  // mapShopifyOrderToFirestore already detects `cancelled_at` and sets
  // internal_status = "CANCELLED" regardless of `previousStatus`.
  const doc = mapShopifyOrderToFirestore(
    payload,
    shopId,
    prevStatus,
    prevData?.lager_tag_synced ?? null,
  );

  // Same canonical re-fetch as in mirrorOrder — see comment there.
  try {
    const fresh = await fetchOrderLineItems(doc.shopify_gid, shopId);
    if (fresh) doc.line_items = fresh;
  } catch (e) {
    log.warn("order_lineitems_refetch_failed", {
      orderId: doc.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  doc.line_items = mergeAutomationLineItems(doc.line_items, prevData?.line_items);

  await ref.set(
    {
      ...doc,
      local_tags: prevData?.local_tags ?? [],
      priority_score: prevData?.priority_score ?? 0,
      automation_hold: prevData?.automation_hold ?? false,
      internal_status: "CANCELLED",
      cancelled_at: payload.cancelled_at
        ? new Date(payload.cancelled_at)
        : new Date(),
      cancel_reason: payload.cancel_reason ?? null,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  await dispatchAutomationEvent({
    shopId,
    trigger: "ORDER_CANCELLED",
    orderId,
  });

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
        {
          internal_status: prevStatus ?? undefined,
          line_items: prevData?.line_items?.map((li) => ({
            variant_id: li.variant_id,
            qty: li.qty,
          })),
        },
      );
    } catch (e) {
      log.warn("release_on_cancel_failed", {
        orderId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Push the freed inventory back to Shopify so the storefront reflects it.
    if (releaseRes && Object.keys(releaseRes.freedByVariant).length > 0) {
      try {
        const { queueInventoryPush } = await import(
          "@/server/inventory/sync-to-shopify"
        );
        const { processOutbox } = await import("@/server/shopify/outbox");
        for (const variantId of Object.keys(releaseRes.freedByVariant)) {
          await queueInventoryPush(
            variantId,
            "cancellation",
            `shrymp-logistics://order/${orderId}/cancelled`,
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
    shopId,
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

async function applyInventoryLevelsUpdate(
  shopId: string,
  body: unknown,
  webhookId: string,
): Promise<DispatchResult> {
  const { loadLagerConfig } = await import("@/server/lager/config");
  const lagerCfg = await loadLagerConfig(shopId);

  if (lagerCfg.inventory_source === "SHOPIFY") {
    const { applyShopifyInventoryLevel } = await import(
      "@/server/inventory/apply-from-shopify"
    );
    const res = await applyShopifyInventoryLevel(shopId, body, webhookId);
    if (!res.applied) {
      log.warn("shopify_inventory_apply_skipped", {
        webhookId,
        reason: res.reason,
      });
      return { kind: "ok", action: `inventory_skipped:${res.reason}` };
    }
    return {
      kind: "ok",
      action: `inventory_applied:${res.variantId ?? "unknown"}`,
    };
  }

  // App is source of truth — external Shopify changes are drift only.
  log.warn("inventory_drift_detected", { webhookId, body });
  return { kind: "ok", action: "drift_logged" };
}

async function handleAppUninstalled(
  shopId: string,
  webhookId: string,
): Promise<DispatchResult> {
  log.warn("shopify_app_uninstalled", { webhookId, shopId });
  await markShopUninstalled(shopId);
  return { kind: "ok", action: "uninstall_noted" };
}
