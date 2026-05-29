import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
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
  durationMs: number;
};

export async function reconcileStuckOrders(): Promise<ReconcileReport> {
  const t0 = Date.now();
  const db = adminDb();
  const cutoff = Timestamp.fromMillis(Date.now() - NEW_TIMEOUT_SEC * 1000);

  // ---- 1. Stuck NEW orders ----
  // Filtering by updated_at on the server keeps the read cheap. If even a
  // single NEW order is older than the cutoff we run a full allocation
  // synchronously — no Cloud Tasks involvement.
  const stuckSnap = await db
    .collection(Collections.Orders)
    .where("internal_status", "==", "NEW")
    .where("updated_at", "<=", cutoff)
    .limit(50)
    .get();

  let reAllocated = false;
  if (!stuckSnap.empty) {
    log.warn("reconcile_stuck_new_orders", {
      count: stuckSnap.size,
      ids: stuckSnap.docs.map((d) => d.id),
    });
    try {
      await runAllocationInFirestore({
        triggeredBy: "RECONCILE",
        triggerEventId: `stuck-new-${Date.now()}`,
      });
      reAllocated = true;
    } catch (e) {
      log.error("reconcile_allocation_failed", { error: String(e) });
    }
  }

  // ---- 2. Tag drift in Firestore mirror ----
  // We only look at the Firestore `tags` field here (cheap). The outbox
  // dispatcher already verifies against Shopify after every push, so if
  // our local mirror says the tag is present, Shopify has it too. The
  // drift case is "internal_status changed but no tag-push outbox row
  // was ever enqueued" — exactly the symptom of the original race.
  let tagDriftFixed = 0;
  for (const status of Object.keys(EXPECTED_TAG)) {
    const cfg = EXPECTED_TAG[status]!;
    const snap = await db
      .collection(Collections.Orders)
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

      // Enqueue corrective outbox rows. The next processOutbox() call (or
      // the one we trigger below) will push them.
      const now = Timestamp.now();
      const batch = db.batch();
      if (needsAdd) {
        const ref = db.collection(Collections.ShopifyOutbox).doc();
        batch.set(ref, {
          id: ref.id,
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
        orderId: o.id,
        status,
        firestoreTags: tags,
        needsAdd: needsAdd ? cfg.add : undefined,
        needsRemove: needsRemove ? cfg.remove : undefined,
      });
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
    await enqueueAllocationRun({
      triggeredBy: "RECONCILE",
      triggerEventId: `tag-drift-${Date.now()}`,
    });
  }

  return {
    stuckNew: stuckSnap.size,
    reAllocated,
    tagDriftFixed,
    durationMs: Date.now() - t0,
  };
}
