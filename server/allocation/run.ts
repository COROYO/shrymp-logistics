import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type AllocationRunStatus,
  type AllocationTrigger,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import { allocate } from "./runAllocation";
import type { AllocationInput, OrderInput, VariantAvail, Decision } from "./types";
import { processOutbox, processOutboxByIds } from "@/server/shopify/outbox";
import { enqueueAllocationRun } from "./enqueue";
import { log } from "@/lib/logger";
import { isBatchExpired } from "@/server/picking/batch-assignability";
import { loadAssignableRemainingByVariant } from "@/server/inventory/shippable-stock";
import { loadPreAssignedShippableOrderIds } from "@/server/picking/pre-assigned-orders";

/**
 * Firestore-backed allocation run.
 *
 * High-level flow (queue concurrency guarantees no parallel writers):
 *   1. Read `orders` (status ∈ {NEW, SHIP, STOP}) and the `variants` they
 *      reference.
 *   2. Compute per-variant available-to-reserve from unassigned assignable
 *      `remaining_qty` (MHD-aware; see shippable-stock.ts) and run `allocate()`
 *      — this only
 *      decides SHIP/STOP, it does NOT bind Chargen. The concrete batch is
 *      picked FEFO later, at packing-slip print time (see assign-batches.ts).
 *   3. Update orders' internal_status and adjust variant.reserved_total by the
 *      in-memory delta (RECONCILE/MANUAL recompute from scratch instead).
 *   4. Release any printed Charge assignments for orders flipped back to STOP
 *      (restore batch.remaining_qty).
 *   5. Queue LAGER_TAGS_SET outbox entries wherever the decision differs from
 *      the LAGER tag state we last confirmed on Shopify (`lager_tag_synced`).
 *   6. Persist `allocation_runs/{runId}` with stats.
 *
 * Orders in PICKING, PACKED or CANCELLED state are NEVER touched.
 */

const ORDER_STATUSES_TO_REALLOCATE = ["NEW", "SHIP", "STOP"] as const;

export type RunAllocationInFirestoreOptions = {
  triggeredBy: AllocationTrigger;
  triggerEventId?: string;
};

export type RunAllocationInFirestoreResult = {
  runId: string;
  shipCount: number;
  stopCount: number;
  expressShipCount: number;
  durationMs: number;
  outbox: { processed: number; failed: number; done: number };
};

export async function runAllocationInFirestore(
  opts: RunAllocationInFirestoreOptions,
): Promise<RunAllocationInFirestoreResult> {
  const db = adminDb();
  const runRef = db.collection(Collections.AllocationRuns).doc();
  const startedAt = FieldValue.serverTimestamp();

  await runRef.set({
    id: runRef.id,
    triggered_by: opts.triggeredBy,
    trigger_event_id: opts.triggerEventId,
    started_at: startedAt,
    status: "RUNNING" satisfies AllocationRunStatus,
  });

  try {
    // ----- 1. Load orders -----
    const ordersSnap = await db
      .collection(Collections.Orders)
      .where("internal_status", "in", [...ORDER_STATUSES_TO_REALLOCATE])
      .get();
    const ordersRaw = ordersSnap.docs.map((d) => d.data() as Order);

    // Quantity currently reserved BY THIS SET (orders presently in SHIP). We
    // "give it back" into the pool, then let the algorithm re-compete for it —
    // so a re-run is idempotent and reservation deltas net out correctly.
    const oldSetReserved = new Map<string, number>();
    for (const o of ordersRaw) {
      if (o.internal_status !== "SHIP") continue;
      for (const li of o.line_items) {
        oldSetReserved.set(
          li.variant_id,
          (oldSetReserved.get(li.variant_id) ?? 0) + li.qty,
        );
      }
    }

    // ----- 2. Load referenced variants → available-to-reserve -----
    // Locked stock = demand of orders currently in PICKING (being packed right
    // now). Those are the only reservations the run must NOT touch. Orders in
    // NEW/SHIP/STOP all re-compete from the remaining pool, so we don't
    // subtract them. We compute this LIVE from order state rather than trusting
    // `variant.reserved_total` — that cache is maintained by the hot-path delta
    // and can drift, which would understate `available` and STOP orders that
    // actually have stock (the bug this replaces).
    const pickingSnap = await db
      .collection(Collections.Orders)
      .where("internal_status", "==", "PICKING")
      .get();
    const lockedByVariant = new Map<string, number>();
    for (const d of pickingSnap.docs) {
      const o = d.data() as Order;
      for (const li of o.line_items ?? []) {
        lockedByVariant.set(
          li.variant_id,
          (lockedByVariant.get(li.variant_id) ?? 0) + li.qty,
        );
      }
    }

    const variantIds = Array.from(
      new Set(ordersRaw.flatMap((o) => o.line_items.map((li) => li.variant_id))),
    );
    const variants: VariantAvail[] = [];
    let preAssignedOrderIds = new Set<string>();
    if (variantIds.length > 0) {
      const variantRefs = variantIds.map((id) =>
        db.collection(Collections.Variants).doc(id),
      );
      const [variantSnaps, remainingByVariant, preAssigned] = await Promise.all(
        [
          db.getAll(...variantRefs),
          loadAssignableRemainingByVariant(variantIds),
          loadPreAssignedShippableOrderIds(ordersRaw),
        ],
      );
      preAssignedOrderIds = preAssigned;
      for (const snap of variantSnaps) {
        if (!snap.exists) continue; // missing → allocate() reports UNKNOWN_VARIANT
        const remaining = remainingByVariant.get(snap.id) ?? 0;
        // Unassigned assignable Chargen minus PICKING lock (already on a slip).
        const available = remaining - (lockedByVariant.get(snap.id) ?? 0);
        variants.push({ variantId: snap.id, available });
      }
    }

    const orders: OrderInput[] = ordersRaw.map((o) => ({
      id: o.id,
      createdAtMs: toMs(o.created_at_shopify),
      tags: o.tags ?? [],
      lineItems: o.line_items.map((li) => ({
        id: li.id,
        variantId: li.variant_id,
        qty: li.qty,
      })),
    }));

    // ----- 3. Allocate (pure) -----
    const input: AllocationInput = {
      variants,
      orders,
      preAssignedOrderIds,
    };
    const result = allocate(input);

    // ----- 4. Commit -----
    // RECONCILE/MANUAL are rare, operator-initiated safety nets: recompute
    // reserved_total from order state (self-healing of any drift). The hot
    // path uses cheap in-memory deltas instead.
    const recomputeMode: "delta" | "full" =
      opts.triggeredBy === "RECONCILE" || opts.triggeredBy === "MANUAL"
        ? "full"
        : "delta";
    const lagerOutboxIds = await commitDecisions(
      runRef.id,
      result.decisions,
      ordersRaw,
      oldSetReserved,
      recomputeMode,
    );

    await runRef.update({
      finished_at: FieldValue.serverTimestamp(),
      status: "COMMITTED" satisfies AllocationRunStatus,
      stats: {
        ship_count: result.stats.shipCount,
        stop_count: result.stats.stopCount,
        duration_ms: Math.round(result.stats.durationMs),
      },
    });

    log.info("allocation_run_committed", {
      runId: runRef.id,
      ...result.stats,
    });

    const outbox = { processed: 0, failed: 0, done: 0 };
    // Push the LAGER tag entries we just created *first* and by id, so they
    // can't be starved by a backlog of older due rows in the windowed drain.
    try {
      const r = await processOutboxByIds(lagerOutboxIds);
      outbox.processed += r.processed;
      outbox.failed += r.failed;
      outbox.done += r.done;
    } catch (e) {
      log.warn("post_run_lager_tag_drain_failed", { error: String(e) });
    }
    try {
      const r = await processOutbox(100);
      outbox.processed += r.processed;
      outbox.failed += r.failed;
      outbox.done += r.done;
    } catch (e) {
      log.warn("post_run_outbox_drain_failed", { error: String(e) });
    }

    // ---- Tail sweep: catch orders that were written DURING this run ----
    // The pre-run snapshot fixed the set we'd process. If a webhook arrived
    // between snapshot read and commit, that order is still in NEW and would
    // otherwise wait for the next external trigger. Re-enqueue if any exist.
    // We bound recursion with an opts flag so we don't loop forever during
    // a steady stream of inbound orders.
    if (opts.triggeredBy !== "TAIL_SWEEP") {
      try {
        const leftover = await db
          .collection(Collections.Orders)
          .where("internal_status", "==", "NEW")
          .limit(1)
          .get();
        if (!leftover.empty) {
          log.info("allocation_tail_sweep_enqueue", {
            runId: runRef.id,
            leftoverNew: leftover.size,
          });
          await enqueueAllocationRun({
            triggeredBy: "TAIL_SWEEP",
            triggerEventId: runRef.id,
          });
        }
      } catch (e) {
        log.warn("tail_sweep_check_failed", { error: String(e) });
      }
    }

    return {
      runId: runRef.id,
      shipCount: result.stats.shipCount,
      stopCount: result.stats.stopCount,
      expressShipCount: result.stats.expressShipCount,
      durationMs: result.stats.durationMs,
      outbox,
    };
  } catch (e) {
    log.error("allocation_run_failed", {
      runId: runRef.id,
      error: String(e),
    });
    await runRef
      .update({
        finished_at: FieldValue.serverTimestamp(),
        status: "FAILED" satisfies AllocationRunStatus,
        error: e instanceof Error ? e.message : String(e),
      })
      .catch(() => {});
    throw e;
  }
}

async function commitDecisions(
  runId: string,
  decisions: Decision[],
  ordersRaw: Order[],
  oldSetReserved: Map<string, number>,
  recomputeMode: "delta" | "full",
): Promise<string[]> {
  const db = adminDb();
  const decisionByOrderId = new Map(decisions.map((d) => [d.orderId, d]));

  // BulkWriter handles batching, throughput throttling and retries for us —
  // no manual 450-op WriteBatch bookkeeping, and writes are parallelized.
  const bulk = db.bulkWriter();

  // Quantity this set reserves AFTER the run (orders now in SHIP), per variant.
  const newSetReserved = new Map<string, number>();
  // Orders flipped to STOP — if any of them were already printed (have open
  // Charge assignments) we must hand the batch stock back.
  const stopOrderIds: string[] = [];
  // Orders whose confirmed LAGER tag state differs from the new decision and
  // therefore need a (re-)push to Shopify: orderId → target status.
  const lagerTagSyncs = new Map<string, "SHIP" | "STOP">();

  for (const o of ordersRaw) {
    const decision =
      decisionByOrderId.get(o.id) ??
      ({ orderId: o.id, status: "STOP", reason: "EMPTY_ORDER" } as const);
    const nextStatus = decision.status === "SHIP" ? "SHIP" : "STOP";

    const orderRef = db.collection(Collections.Orders).doc(o.id);
    void bulk.update(orderRef, {
      internal_status: nextStatus,
      stop_reason:
        decision.status === "STOP" ? decision.reason : FieldValue.delete(),
      allocation_run_id: runId,
      updated_at: FieldValue.serverTimestamp(),
    });

    if (nextStatus === "SHIP") {
      for (const li of o.line_items) {
        newSetReserved.set(
          li.variant_id,
          (newSetReserved.get(li.variant_id) ?? 0) + li.qty,
        );
      }
    } else {
      stopOrderIds.push(o.id);
    }

    // LAGER tags are owned by our system — never derived from Shopify's tag
    // mirror. Push (set the correct LAGER tag, drop the opposite) whenever the
    // decision differs from the tag state we last *confirmed* on Shopify. This
    // repairs drift: a previous push that silently failed left `lager_tag_synced`
    // unchanged, so it gets retried here instead of being skipped.
    if (nextStatus !== o.lager_tag_synced) {
      lagerTagSyncs.set(o.id, nextStatus);
    }
  }

  // --- Release Charge assignments for orders flipped back to STOP ---
  // Normally a SHIP order isn't printed until PICKING (which the run never
  // touches), but external inventory drift can force a printed SHIP order to
  // STOP. Give its assigned batch stock back so it's assignable again.
  if (stopOrderIds.length > 0) {
    await releaseAssignmentsForStoppedOrders(bulk, stopOrderIds);
  }

  // --- Update variant reserved_total / available ---
  if (recomputeMode === "full") {
    // Self-healing path (RECONCILE/MANUAL): flush writes first, then recompute
    // reserved_total from authoritative order state.
    await bulk.close();
    await recomputeReservedTotals(
      new Set(ordersRaw.flatMap((o) => o.line_items.map((li) => li.variant_id))),
    );
  } else {
    // Hot path: apply the in-memory delta = (now reserved by set) − (was
    // reserved by set). on_hand is untouched, so available moves opposite.
    const vids = new Set<string>([
      ...oldSetReserved.keys(),
      ...newSetReserved.keys(),
    ]);
    for (const vid of vids) {
      const delta =
        (newSetReserved.get(vid) ?? 0) - (oldSetReserved.get(vid) ?? 0);
      if (delta === 0) continue;
      const ref = db.collection(Collections.Variants).doc(vid);
      void bulk.update(ref, {
        reserved_total: FieldValue.increment(delta),
        available: FieldValue.increment(-delta),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    await bulk.close();
  }

  // --- Outbox entries for Shopify LAGER tag pushes ---
  if (lagerTagSyncs.size === 0) return [];
  return enqueueLagerTagSync(lagerTagSyncs);
}

/**
 * Delete any open (un-consumed) Charge assignments for the given orders and
 * return their stock to the batches (`remaining_qty += qty`). Uses atomic
 * increments so it's safe against a concurrent print transaction on the same
 * batch.
 */
async function releaseAssignmentsForStoppedOrders(
  bulk: FirebaseFirestore.BulkWriter,
  orderIds: string[],
): Promise<void> {
  const db = adminDb();
  const referenceDate = new Date();
  const snaps = await Promise.all(
    chunk(orderIds, 30).map((c) =>
      db.collection(Collections.Allocations).where("order_id", "in", c).get(),
    ),
  );
  const restoreByBatch = new Map<string, number>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const a = doc.data() as Allocation;
      if (a.consumed_at) continue; // packed or already released → leave
      void bulk.delete(doc.ref);
      restoreByBatch.set(a.batch_id, (restoreByBatch.get(a.batch_id) ?? 0) + a.qty);
    }
  }
  const batchSnaps = await Promise.all(
    [...restoreByBatch.keys()].map((id) =>
      db.collection(Collections.Batches).doc(id).get(),
    ),
  );
  const batchExpiryById = new Map<string, unknown>();
  for (const snap of batchSnaps) {
    if (snap.exists) {
      batchExpiryById.set(snap.id, (snap.data() as Batch).expiry_date);
    }
  }
  for (const [batchId, qty] of restoreByBatch) {
    if (qty === 0) continue;
    const ref = db.collection(Collections.Batches).doc(batchId);
    const expiry = batchExpiryById.get(batchId);
    void bulk.update(ref, {
      remaining_qty: FieldValue.increment(qty),
      status:
        expiry && isBatchExpired(expiry, referenceDate) ? "EXPIRED" : "ACTIVE",
    });
  }
}

/**
 * Recompute reserved_total from authoritative order state: a variant's
 * reservation = Σ line-item qty over all orders in SHIP or PICKING (decided to
 * ship, not yet packed). Used only by the rare RECONCILE/MANUAL self-heal.
 */
async function recomputeReservedTotals(variantIds: Set<string>): Promise<void> {
  const db = adminDb();
  const ids = [...variantIds];
  if (ids.length === 0) return;

  const reservedByVariant = new Map<string, number>();
  for (const status of ["SHIP", "PICKING"] as const) {
    const snap = await db
      .collection(Collections.Orders)
      .where("internal_status", "==", status)
      .get();
    for (const d of snap.docs) {
      const o = d.data() as Order;
      for (const li of o.line_items) {
        if (!variantIds.has(li.variant_id)) continue;
        reservedByVariant.set(
          li.variant_id,
          (reservedByVariant.get(li.variant_id) ?? 0) + li.qty,
        );
      }
    }
  }

  const refs = ids.map((vid) => db.collection(Collections.Variants).doc(vid));
  const snaps = await db.getAll(...refs);

  const bulk = db.bulkWriter();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const cur = snap.data() ?? {};
    const onHand = (cur["on_hand_total"] as number | undefined) ?? 0;
    const reserved = reservedByVariant.get(snap.id) ?? 0;
    void bulk.update(snap.ref, {
      reserved_total: reserved,
      available: onHand - reserved,
      updated_at: FieldValue.serverTimestamp(),
    });
  }
  await bulk.close();
}

async function enqueueLagerTagSync(
  syncs: Map<string, "SHIP" | "STOP">,
): Promise<string[]> {
  const db = adminDb();
  const bulk = db.bulkWriter();
  const now = FieldValue.serverTimestamp();
  const ids: string[] = [];

  for (const [orderId, status] of syncs) {
    // Deterministic id per order: a re-enqueue overwrites any still-pending
    // entry instead of piling up duplicate tag pushes for the same order.
    const ref = db
      .collection(Collections.ShopifyOutbox)
      .doc(`lagertags_${orderId}`);
    void bulk.set(ref, {
      id: ref.id,
      op: "LAGER_TAGS_SET",
      payload: { orderId, status },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    ids.push(ref.id);
  }
  await bulk.close();
  return ids;
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toMs(ts: unknown): number {
  if (ts == null) return 0;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "string") return new Date(ts).getTime();
  if (typeof ts === "object") {
    const o = ts as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof o.toMillis === "function") return o.toMillis();
    if (typeof o.seconds === "number") {
      return o.seconds * 1000 + (o.nanoseconds ?? 0) / 1e6;
    }
  }
  return 0;
}
