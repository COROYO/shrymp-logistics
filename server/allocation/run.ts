import "server-only";
import {
  FieldValue,
  type DocumentReference,
  type WriteBatch,
} from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type AllocationRunStatus,
  type Batch,
  type Order,
} from "@/server/firestore/schema";
import { allocate } from "./runAllocation";
import type {
  AllocationInput,
  BatchAvail,
  OrderInput,
  Decision,
} from "./types";
import { processOutbox, processOutboxByIds } from "@/server/shopify/outbox";
import { enqueueAllocationRun } from "./enqueue";
import { log } from "@/lib/logger";

/**
 * Firestore-backed allocation run.
 *
 * High-level flow (queue concurrency guarantees no parallel writers):
 *   1. Read `batches` (ACTIVE, remaining_qty > 0).
 *   2. Read `orders` (status ∈ {NEW, SHIP, STOP}).
 *   3. Build pure inputs, run `allocate()`.
 *   4. In bulk-writer batches: delete prior allocations for those orders,
 *      write new allocations, update orders, recompute variant.reserved_total.
 *   5. Append RESERVE/RELEASE inventory_movements (audit).
 *   6. Queue LAGER_TAGS_SET outbox entries wherever the decision differs from
 *      the LAGER tag state we last confirmed on Shopify (`lager_tag_synced`).
 *      LAGER tags are system-owned; this repairs drift, not just status changes.
 *   7. Persist `allocation_runs/{runId}` with stats.
 *
 * Orders in PACKED or CANCELLED state are NEVER touched.
 */

const ORDER_STATUSES_TO_REALLOCATE = ["NEW", "SHIP", "STOP"] as const;

export type RunAllocationInFirestoreOptions = {
  triggeredBy:
    | "ORDER_CREATED"
    | "ORDER_UPDATED"
    | "ORDER_CANCELLED"
    | "INBOUND"
    | "PACKING_DONE"
    | "MANUAL"
    | "RECONCILE"
    | "TAIL_SWEEP";
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
    // ----- 1. Load -----
    const [batchesSnap, ordersSnap] = await Promise.all([
      db.collection(Collections.Batches).where("status", "==", "ACTIVE").get(),
      db
        .collection(Collections.Orders)
        .where("internal_status", "in", [...ORDER_STATUSES_TO_REALLOCATE])
        .get(),
    ]);

    const batches: BatchAvail[] = batchesSnap.docs
      .map((d) => d.data() as Batch)
      .filter((b) => (b.remaining_qty ?? 0) > 0)
      .map((b) => ({
        id: b.id,
        variantId: b.variant_id,
        chargeNumber: b.charge_number,
        expiryDateMs: toMs(b.expiry_date),
        remaining: b.remaining_qty,
      }));

    const ordersRaw = ordersSnap.docs.map((d) => d.data() as Order);
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

    // ----- 2. Allocate (pure) -----
    const input: AllocationInput = { batches, orders };
    const result = allocate(input);

    // ----- 3. Commit -----
    const lagerOutboxIds = await commitDecisions(
      runRef,
      result.decisions,
      ordersRaw,
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
  runRef: DocumentReference,
  decisions: Decision[],
  ordersRaw: Order[],
): Promise<string[]> {
  const db = adminDb();
  const runId = runRef.id;

  const ordersToReallocate = ordersRaw.map((o) => o.id);
  const decisionByOrderId = new Map(decisions.map((d) => [d.orderId, d]));

  // --- Step A: delete prior allocations for orders being reallocated ---
  if (ordersToReallocate.length > 0) {
    const oldAllocSnap = await db
      .collection(Collections.Allocations)
      .where("order_id", "in", ordersToReallocate.slice(0, 30))
      .get();
    // Firestore `in` is limited to 30 values per query; chunk if larger.
    const extraSnaps = await Promise.all(
      chunk(ordersToReallocate.slice(30), 30).map((c) =>
        db.collection(Collections.Allocations).where("order_id", "in", c).get(),
      ),
    );

    let delBatch = db.batch();
    let opsInBatch = 0;
    const flush = async (b: WriteBatch) => {
      if (opsInBatch > 0) {
        await b.commit();
        opsInBatch = 0;
      }
    };
    for (const snap of [oldAllocSnap, ...extraSnaps]) {
      for (const doc of snap.docs) {
        const alloc = doc.data() as Allocation;
        if (alloc.consumed_at) continue; // already consumed (packed) → keep
        delBatch.delete(doc.ref);
        opsInBatch++;
        if (opsInBatch >= 450) {
          await delBatch.commit();
          delBatch = db.batch();
          opsInBatch = 0;
        }
      }
    }
    await flush(delBatch);
  }

  // --- Step B: write new allocations + update orders + recompute reservations ---
  // Variant reservation deltas: variantId → delta (+ reserved, - reserved)
  const reservedDelta = new Map<string, number>();
  // Orders whose confirmed LAGER tag state differs from the new decision and
  // therefore need a (re-)push to Shopify: orderId → target status.
  const lagerTagSyncs = new Map<string, "SHIP" | "STOP">();

  let writeBatch = db.batch();
  let opsInBatch = 0;
  const flush = async (b: WriteBatch) => {
    if (opsInBatch > 0) {
      await b.commit();
      opsInBatch = 0;
    }
  };

  for (const o of ordersRaw) {
    const decision =
      decisionByOrderId.get(o.id) ??
      ({ orderId: o.id, status: "STOP", reason: "EMPTY_ORDER" } as const);
    const nextStatus = decision.status === "SHIP" ? "SHIP" : "STOP";

    const orderRef = db.collection(Collections.Orders).doc(o.id);
    writeBatch.update(orderRef, {
      internal_status: nextStatus,
      stop_reason:
        decision.status === "STOP" ? decision.reason : FieldValue.delete(),
      allocation_run_id: runId,
      updated_at: FieldValue.serverTimestamp(),
    });
    opsInBatch++;

    if (decision.status === "SHIP") {
      for (const a of decision.allocations) {
        const ref = db.collection(Collections.Allocations).doc();
        writeBatch.set(ref, {
          id: ref.id,
          order_id: o.id,
          line_item_id: a.lineItemId,
          variant_id:
            o.line_items.find((li) => li.id === a.lineItemId)?.variant_id ?? "",
          batch_id: a.batchId,
          qty: a.qty,
          run_id: runId,
          created_at: FieldValue.serverTimestamp(),
        });
        opsInBatch++;
        // RESERVE movement
        const movRef = db.collection(Collections.InventoryMovements).doc();
        writeBatch.set(movRef, {
          id: movRef.id,
          type: "RESERVE",
          batch_id: a.batchId,
          variant_id:
            o.line_items.find((li) => li.id === a.lineItemId)?.variant_id ?? "",
          qty: a.qty,
          ref: { kind: "ALLOCATION_RUN", id: runId },
          user_id: null,
          created_at: FieldValue.serverTimestamp(),
        });
        opsInBatch++;

        const li = o.line_items.find((x) => x.id === a.lineItemId);
        if (li) {
          reservedDelta.set(
            li.variant_id,
            (reservedDelta.get(li.variant_id) ?? 0) + a.qty,
          );
        }
      }
    }

    // LAGER tags are owned by our system — never derived from Shopify's tag
    // mirror. Push (set the correct LAGER tag, drop the opposite) whenever the
    // decision differs from the tag state we last *confirmed* on Shopify. This
    // repairs drift: a previous push that silently failed left `lager_tag_synced`
    // unchanged, so it gets retried here instead of being skipped.
    if (nextStatus !== o.lager_tag_synced) {
      lagerTagSyncs.set(o.id, nextStatus);
    }

    if (opsInBatch >= 450) {
      await writeBatch.commit();
      writeBatch = db.batch();
      opsInBatch = 0;
    }
  }
  await flush(writeBatch);

  // --- Step C: also account for RELEASE movements for orders whose
  //              SHIP reservation got revoked. We just need to update
  //              variant.reserved_total based on the new set of allocations.
  //              Easiest: recompute reserved_total per affected variant from
  //              the current allocations table.
  // -------------------------------------------------------------------------
  await recomputeReservedTotals(
    new Set(ordersRaw.flatMap((o) => o.line_items.map((li) => li.variant_id))),
  );

  // --- Step D: outbox entries for Shopify LAGER tag pushes ---
  if (lagerTagSyncs.size === 0) return [];
  return enqueueLagerTagSync(lagerTagSyncs);
}

async function recomputeReservedTotals(variantIds: Set<string>): Promise<void> {
  const db = adminDb();
  const ids = [...variantIds];
  if (ids.length === 0) return;

  // Reservation per variant = sum of allocations.qty where consumed_at is null.
  // We aggregate by reading all open allocations for these variants in chunks of 30.
  const reservedByVariant = new Map<string, number>();
  for (const c of chunk(ids, 30)) {
    const snap = await db
      .collection(Collections.Allocations)
      .where("variant_id", "in", c)
      .get();
    for (const d of snap.docs) {
      const a = d.data() as Allocation;
      if (a.consumed_at) continue;
      reservedByVariant.set(
        a.variant_id,
        (reservedByVariant.get(a.variant_id) ?? 0) + a.qty,
      );
    }
  }

  let batch = db.batch();
  let ops = 0;
  for (const vid of ids) {
    const ref = db.collection(Collections.Variants).doc(vid);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const cur = snap.data() ?? {};
    const onHand = (cur["on_hand_total"] as number | undefined) ?? 0;
    const reserved = reservedByVariant.get(vid) ?? 0;
    batch.update(ref, {
      reserved_total: reserved,
      available: onHand - reserved,
      updated_at: FieldValue.serverTimestamp(),
    });
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}

async function enqueueLagerTagSync(
  syncs: Map<string, "SHIP" | "STOP">,
): Promise<string[]> {
  const db = adminDb();
  let batch = db.batch();
  let ops = 0;
  const now = FieldValue.serverTimestamp();
  const ids: string[] = [];

  for (const [orderId, status] of syncs) {
    // Deterministic id per order: a re-enqueue overwrites any still-pending
    // entry instead of piling up duplicate tag pushes for the same order.
    const ref = db
      .collection(Collections.ShopifyOutbox)
      .doc(`lagertags_${orderId}`);
    batch.set(ref, {
      id: ref.id,
      op: "LAGER_TAGS_SET",
      payload: { orderId, status },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    ids.push(ref.id);
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
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
