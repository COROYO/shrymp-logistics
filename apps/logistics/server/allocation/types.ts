/**
 * Pure-function types for the allocation algorithm.
 *
 * Intentionally decoupled from Firestore document shapes so that
 * the algorithm is trivially unit-testable and Firestore-agnostic.
 * The caller is responsible for mapping Firestore docs ↔ these types.
 */

/**
 * Available-to-reserve units for a single variant.
 *
 * Batches (Chargen) are no longer part of the allocation decision — the run
 * only decides SHIP/STOP and reserves quantity at the variant level. The
 * concrete Charge is picked FEFO later, when the packing slip is printed.
 */
export type VariantAvail = {
  variantId: string;
  /** Unassigned assignable `remaining_qty` minus PICKING-Sperre (see shippable-stock.ts). */
  available: number;
};

export type OrderLineItemInput = {
  id: string;
  variantId: string;
  qty: number;
};

export type OrderInput = {
  id: string;
  /** Epoch milliseconds. Tiebreaker for ordering — earlier wins. */
  createdAtMs: number;
  tags: string[];
  lineItems: OrderLineItemInput[];
  /**
   * Fine-grained priority within a lane (0–100). Phase A membership still
   * comes from configured priority tags; within each phase we sort by score
   * DESC, then createdAt ASC.
   */
  priorityScore?: number;
  /** Raw Shopify financial status (`paid` / `PAID`). Omitted = no status gate. */
  financialStatus?: string | null;
  /** Raw Shopify fulfillment status. REST null means unfulfilled. */
  fulfillmentStatus?: string | null;
};

export type Decision =
  | {
      orderId: string;
      status: "SHIP";
      mode: "EXPRESS" | "STANDARD";
    }
  | {
      orderId: string;
      status: "STOP";
      reason: StopReason;
    };

export type StopReason =
  | "INSUFFICIENT_STOCK"
  | "UNKNOWN_VARIANT"
  | "EMPTY_ORDER"
  | "BATCH_EXPIRED"
  | "BATCH_NEAR_EXPIRY"
  | "PAYMENT_STATUS"
  | "FULFILLMENT_STATUS";

export type AllocationInput = {
  variants: VariantAvail[];
  orders: OrderInput[];
  /** Complete, shippable Charge assignment — SHIP without consuming remaining pool. */
  preAssignedOrderIds?: ReadonlySet<string>;
  /**
   * Shopify tags that put an order into Phase A (priority lane).
   * Defaults to `[EXPRESS_TAG]` when omitted — keeps unit tests simple.
   */
  priorityTags?: readonly string[];
  /**
   * Shopify statuses that may be marked SHIP. Both lists must be set for the
   * gate to run. A list that contains every known status does not filter.
   * Inventory rules still apply on top.
   */
  shipPaymentStatuses?: readonly string[];
  shipFulfillmentStatuses?: readonly string[];
};

export type AllocationStats = {
  shipCount: number;
  stopCount: number;
  expressShipCount: number;
  durationMs: number;
};

export type AllocationResult = {
  decisions: Decision[];
  stats: AllocationStats;
};

/** @deprecated Prefer shop-configured `priority_tags`; kept as default fallback. */
export const EXPRESS_TAG = "EXPRESS_DHL";

/** True when the order carries any configured priority tag. */
export function hasPriorityTag(
  tags: readonly string[],
  priorityTags: readonly string[],
): boolean {
  if (priorityTags.length === 0 || tags.length === 0) return false;
  const set = new Set(priorityTags);
  return tags.some((t) => set.has(t));
}
