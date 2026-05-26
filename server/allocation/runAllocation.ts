import { buildBatchPool, clonePool } from "./fefo";
import {
  type AllocLine,
  type AllocationInput,
  type AllocationResult,
  type BatchAvail,
  type Decision,
  EXPRESS_TAG,
  type OrderInput,
} from "./types";

/**
 * Pure, deterministic allocation algorithm.
 *
 * Three phases (see plan):
 *   A. Express priority — orders tagged EXPRESS_DHL, ordered by createdAt ASC.
 *   B. Standard greedy — smallest total demand first, tiebreak createdAt ASC,
 *      then order id ASC.
 *   C. (Out of scope here — implemented separately in `swap.ts`.)
 *
 * Within an order, batches are consumed FEFO: oldest expiry first.
 *
 * Returns decisions in the *same order* as the input `orders` array,
 * which keeps the caller's iteration predictable.
 */
export function allocate(input: AllocationInput): AllocationResult {
  const t0 = nowMs();

  const pool = buildBatchPool(input.batches);
  const decisions = new Map<string, Decision>();

  // Phase A: Express orders (hard priority).
  const express = input.orders
    .filter((o) => o.tags.includes(EXPRESS_TAG))
    .sort(byCreatedAtThenId);

  for (const order of express) {
    tryAllocate(order, pool, decisions, "EXPRESS");
  }

  // Phase B: Standard orders, smallest total demand first.
  const standard = input.orders
    .filter((o) => !o.tags.includes(EXPRESS_TAG))
    .sort((a, b) => {
      const da = totalUnits(a);
      const db = totalUnits(b);
      if (da !== db) return da - db;
      return byCreatedAtThenId(a, b);
    });

  for (const order of standard) {
    tryAllocate(order, pool, decisions, "STANDARD");
  }

  const ordered: Decision[] = input.orders.map(
    (o) =>
      decisions.get(o.id) ?? {
        orderId: o.id,
        status: "STOP",
        reason: "EMPTY_ORDER",
      },
  );

  let shipCount = 0;
  let expressShipCount = 0;
  let stopCount = 0;
  for (const d of ordered) {
    if (d.status === "SHIP") {
      shipCount++;
      if (d.mode === "EXPRESS") expressShipCount++;
    } else {
      stopCount++;
    }
  }

  return {
    decisions: ordered,
    stats: {
      shipCount,
      stopCount,
      expressShipCount,
      durationMs: nowMs() - t0,
    },
  };
}

function tryAllocate(
  order: OrderInput,
  pool: Map<string, BatchAvail[]>,
  decisions: Map<string, Decision>,
  mode: "EXPRESS" | "STANDARD",
): void {
  if (order.lineItems.length === 0) {
    decisions.set(order.id, {
      orderId: order.id,
      status: "STOP",
      reason: "EMPTY_ORDER",
    });
    return;
  }

  // Probe on a clone — if any line item can't be fully fulfilled,
  // roll back by never committing to `pool`.
  const probe = clonePool(pool);
  const tentative: AllocLine[] = [];

  for (const li of order.lineItems) {
    const list = probe.get(li.variantId);
    if (!list || list.length === 0) {
      decisions.set(order.id, {
        orderId: order.id,
        status: "STOP",
        reason: list === undefined ? "UNKNOWN_VARIANT" : "INSUFFICIENT_STOCK",
      });
      return;
    }

    let need = li.qty;
    for (const batch of list) {
      if (need === 0) break;
      if (batch.remaining <= 0) continue;
      const take = Math.min(batch.remaining, need);
      batch.remaining -= take;
      need -= take;
      tentative.push({
        lineItemId: li.id,
        batchId: batch.id,
        qty: take,
      });
    }

    if (need > 0) {
      decisions.set(order.id, {
        orderId: order.id,
        status: "STOP",
        reason: "INSUFFICIENT_STOCK",
      });
      return;
    }
  }

  // Commit: copy probe → pool.
  for (const [variantId, list] of probe) {
    pool.set(
      variantId,
      list.map((b) => ({ ...b })),
    );
  }

  decisions.set(order.id, {
    orderId: order.id,
    status: "SHIP",
    allocations: tentative,
    mode,
  });
}

function totalUnits(order: OrderInput): number {
  let sum = 0;
  for (const li of order.lineItems) sum += li.qty;
  return sum;
}

function byCreatedAtThenId(a: OrderInput, b: OrderInput): number {
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
  return a.id.localeCompare(b.id);
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
