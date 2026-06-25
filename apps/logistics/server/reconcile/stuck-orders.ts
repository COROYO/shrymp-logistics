import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import { ordersForShop } from "@/server/tenant/queries";
import { listActiveShops } from "@/server/tenant/shop";
import { runWithTenantAsync } from "@/server/tenant/context";
import { runAllocationInFirestore } from "@/server/allocation/run";

/**
 * Reconciliation sweep — the final safety net.
 *
 * Run periodically (every 5 min via Cloud Scheduler). Catches anything that
 * the realtime path missed:
 *
 *   1. Orders stuck in NEW for > NEW_TIMEOUT_SEC → run allocation INLINE
 *      (synchronous, not via Cloud Tasks — we don't trust the queue here,
 *      it's exactly what failed if we're seeing stuck orders).
 *   2. Orders in SHIP/STOP/PACKED where the Firestore `tags` mirror is
 *      missing the expected Lager-tag → re-enqueue a tag-push outbox row.
 *
 * Cheap to run: ~3 small Firestore queries + 0-N writes.
 */

const NEW_TIMEOUT_SEC = 60;

const EXPECTED_TAG: Record<string, { add: string; remove: string[] }> = {
  SHIP: { add: "LAGER_SHIP", remove: ["LAGER_STOP", "LAGER_PACKED"] },
  PICKING: { add: "LAGER_SHIP", remove: ["LAGER_STOP", "LAGER_PACKED"] },
  STOP: { add: "LAGER_STOP", remove: ["LAGER_SHIP", "LAGER_PACKED"] },
  PACKED: { add: "LAGER_PACKED", remove: ["LAGER_SHIP", "LAGER_STOP"] },
};

export type ReconcileReport = {
  stuckNew: number;
  reAllocated: boolean;
  tagDriftFixed: number;
  expiredBatchesMarked: number;
  durationMs: number;
};

export async function reconcileStuckOrders(): Promise<ReconcileReport> {
  const t0 = Date.now();
  const db = adminDb();
  const cutoff = Timestamp.fromMillis(Date.now() - NEW_TIMEOUT_SEC * 1000);

  let stuckNew = 0;
  let reAllocated = false;
  let tagDriftFixed = 0;

  const shops = await listActiveShops();
  for (const shop of shops) {
    const shopId = shop.id;

    const stuckSnap = await ordersForShop(db, shopId)
      .where("internal_status", "==", "NEW")
      .where("updated_at", "<=", cutoff)
      .limit(50)
      .get();

    if (!stuckSnap.empty) {
      stuckNew += stuckSnap.size;
      log.warn("reconcile_stuck_new_orders", {
        shopId,
        count: stuckSnap.size,
        ids: stuckSnap.docs.map((d) => d.id),
      });
      try {
        await runWithTenantAsync(shopId, () =>
          runAllocationInFirestore({
            shopId,
            triggeredBy: "RECONCILE",
            triggerEventId: `stuck-new-${shopId}-${Date.now()}`,
          }),
        );
        reAllocated = true;
      } catch (e) {
        log.error("reconcile_allocation_failed", { shopId, error: String(e) });
      }
    }

    for (const status of Object.keys(EXPECTED_TAG)) {
      const cfg = EXPECTED_TAG[status]!;
      const snap = await ordersForShop(db, shopId)
        .where("internal_status", "==", status)
        .where("updated_at", "<=", cutoff)
        .limit(100)
        .get();
      for (const d of snap.docs) {
        const o = d.data() as Order;
        const tags = o.tags ?? [];
        const needsAdd = !tags.includes(cfg.add);
        const needsRemove = cfg.remove.some((t) => tags.includes(t));
        if (!needsAdd && !needsRemove) continue;

        const now = Timestamp.now();
        const batch = db.batch();
        if (needsAdd) {
          const ref = db.collection(Collections.ShopifyOutbox).doc();
          batch.set(ref, {
            id: ref.id,
            shop_id: shopId,
            op: "TAGS_ADD",
            payload: { orderId: o.id, tags: [cfg.add] },
            attempts: 0,
            next_retry_at: now,
            created_at: now,
          });
        }
        if (needsRemove) {
          const ref = db.collection(Collections.ShopifyOutbox).doc();
          batch.set(ref, {
            id: ref.id,
            shop_id: shopId,
            op: "TAGS_REMOVE",
            payload: {
              orderId: o.id,
              tags: cfg.remove.filter((t) => tags.includes(t)),
            },
            attempts: 0,
            next_retry_at: now,
            created_at: now,
          });
        }
        await batch.commit();
        tagDriftFixed++;
        log.warn("reconcile_tag_drift", {
          shopId,
          orderId: o.id,
          status,
          firestoreTags: tags,
          needsAdd: needsAdd ? cfg.add : undefined,
          needsRemove: needsRemove ? cfg.remove : undefined,
        });
      }
    }
  }

  // If we enqueued anything, drain immediately — same serverless-survivability
  // reason as elsewhere.
  if (tagDriftFixed > 0) {
    try {
      const { processOutbox } = await import("@/server/shopify/outbox");
      await processOutbox(50);
    } catch (e) {
      log.warn("reconcile_outbox_drain_failed", { error: String(e) });
    }
  }

  // If we did fix tag drift but did NOT re-allocate, also enqueue a single
  // allocation run so any STOP-orders that drifted into SHIP have their
  // allocations restored.
  if (tagDriftFixed > 0 && !reAllocated) {
    const { listActiveShops } = await import("@/server/tenant/shop");
    const shops = await listActiveShops();
    for (const shop of shops) {
      await enqueueAllocationRun({
        shopId: shop.id,
        triggeredBy: "RECONCILE",
        triggerEventId: `tag-drift-${shop.id}-${Date.now()}`,
      });
    }
  }

  let expiredBatchesMarked = 0;
  try {
    const { markExpiredBatches } = await import(
      "@/server/inventory/mark-expired-batches"
    );
    const r = await markExpiredBatches();
    expiredBatchesMarked = r.marked;
    if (r.marked > 0) {
      log.warn("reconcile_expired_batches_marked", { count: r.marked });
    }
  } catch (e) {
    log.error("reconcile_mark_expired_failed", { error: String(e) });
  }

  return {
    stuckNew,
    reAllocated,
    tagDriftFixed,
    expiredBatchesMarked,
    durationMs: Date.now() - t0,
  };
}
