import type { OrderInternalStatus } from "@/server/firestore/schema";

/**
 * The internal-order statuses an allocation run *owns* and is allowed to
 * (re)write. Everything else — PICKING, PACKED, CANCELLED — is owned by its own
 * transactional transition.
 *
 * Also the set of statuses the run loads for re-allocation.
 */
export const REALLOCATABLE_STATUSES = ["NEW", "SHIP", "STOP"] as const;

const REALLOCATABLE_SET: ReadonlySet<string> = new Set(REALLOCATABLE_STATUSES);

/**
 * Whether an allocation run may (re)write an order's `internal_status`, given
 * the order's **current, freshly re-read** status (NOT the pre-run snapshot).
 *
 * The run computes decisions from a snapshot that can be many seconds old (long
 * runs, queue backlog). In that window an order can advance to PICKING/PACKED/
 * CANCELLED via its own transaction. Blind-writing a stale SHIP/STOP decision
 * over a PACKED order resurrects it to SHIP — and a later fulfillment webhook
 * then consumes its Chargen a SECOND time (double stock deduction). So the run
 * may only touch orders that are still in one of its own states.
 */
export function allocationRunMayWriteStatus(
  current: OrderInternalStatus | null | undefined,
): boolean {
  return current != null && REALLOCATABLE_SET.has(current);
}

/**
 * The internal_status a MIRROR or SYNC write may persist for an order.
 *
 * These paths mirror Shopify data; they do NOT own the internal state machine
 * (allocation / picking / fulfillment do). So they must never *change* an
 * existing order's status — only initialise a brand-new order to NEW, or move
 * forward to CANCELLED when Shopify reports a cancellation.
 *
 * Pass the order's CURRENT status (freshly re-read, ideally inside the write
 * transaction). This makes it impossible for a mirror/sync to revert a
 * PACKED / PICKING / STOP order back to SHIP/NEW — the root cause of the
 * double-deduction (a resurrected PACKED order gets its Chargen consumed twice).
 */
export function mirrorInternalStatus(
  currentFresh: OrderInternalStatus | null | undefined,
  isCancelled: boolean,
): OrderInternalStatus {
  if (isCancelled) return "CANCELLED";
  return currentFresh ?? "NEW";
}
