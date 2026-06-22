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
