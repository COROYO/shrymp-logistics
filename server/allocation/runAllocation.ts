import {
  type AllocationInput,
  type AllocationResult,
  type Decision,
  EXPRESS_TAG,
  type OrderInput,
} from "./types";

/**
 * Pure, deterministic allocation algorithm.
 *
 * Decides only SHIP vs STOP and reserves quantity at the *variant* level.
 * Concrete Charge (batch) selection happens later, at packing-slip print
 * time (FEFO), so this algorithm no longer knows about batches at all.
 *
 * Two phases (see plan):
 *   A. Express priority — orders tagged EXPRESS_DHL, ordered by createdAt ASC.
 *   B. Standard — chronological, oldest createdAt first (tiebreak order id ASC).
 *      All-or-nothing per order; an order that doesn't fit is stopped and
 *      skipped, leaving stock for later (smaller) orders.
 *
 * Returns decisions in the *same order* as the input `orders` array.
 */
export function allocate(input: AllocationInput): AllocationResult {
  const t0 = nowMs();

  // Mutable available-to-reserve pool per variant.
  const avail = new Map<string, number>();
  for (const v of input.variants) avail.set(v.variantId, v.available);

  const decisions = new Map<string, Decision>();

  // Phase A: Express orders (hard priority).
  const express = input.orders
    .filter((o) => o.tags.includes(EXPRESS_TAG))
    .sort(byCreatedAtThenId);
  const preAssigned = input.preAssignedOrderIds;
  for (const order of express)
    tryAllocate(order, avail, decisions, "EXPRESS", preAssigned);

  // Phase B: Standard orders, chronological (oldest createdAt first).
  const standard = input.orders
    .filter((o) => !o.tags.includes(EXPRESS_TAG))
    .sort(byCreatedAtThenId);
  for (const order of standard)
    tryAllocate(order, avail, decisions, "STANDARD", preAssigned);

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
  avail: Map<string, number>,
  decisions: Map<string, Decision>,
  mode: "EXPRESS" | "STANDARD",
  preAssigned?: ReadonlySet<string>,
): void {
  if (preAssigned?.has(order.id)) {
    decisions.set(order.id, { orderId: order.id, status: "SHIP", mode });
    return;
  }

  if (order.lineItems.length === 0) {
    decisions.set(order.id, {
      orderId: order.id,
      status: "STOP",
      reason: "EMPTY_ORDER",
    });
    return;
  }

  // Aggregate required quantity per variant (a variant can appear on several
  // line items of the same order).
  const need = new Map<string, number>();
  for (const li of order.lineItems) {
    need.set(li.variantId, (need.get(li.variantId) ?? 0) + li.qty);
  }

  // All-or-nothing probe: every variant must have enough available.
  for (const [variantId, qty] of need) {
    const have = avail.get(variantId);
    if (have === undefined) {
      decisions.set(order.id, {
        orderId: order.id,
        status: "STOP",
        reason: "UNKNOWN_VARIANT",
      });
      return;
    }
    if (have < qty) {
      decisions.set(order.id, {
        orderId: order.id,
        status: "STOP",
        reason: "INSUFFICIENT_STOCK",
      });
      return;
    }
  }

  // Commit: consume from the pool.
  for (const [variantId, qty] of need) {
    avail.set(variantId, (avail.get(variantId) ?? 0) - qty);
  }

  decisions.set(order.id, {
    orderId: order.id,
    status: "SHIP",
    mode,
  });
}

function byCreatedAtThenId(a: OrderInput, b: OrderInput): number {
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
  return a.id.localeCompare(b.id);
}

function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
