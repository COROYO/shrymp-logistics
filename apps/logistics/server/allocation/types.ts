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
  | "BATCH_NEAR_EXPIRY";

export type AllocationInput = {
  variants: VariantAvail[];
  orders: OrderInput[];
  /** Complete, shippable Charge assignment — SHIP without consuming remaining pool. */
  preAssignedOrderIds?: ReadonlySet<string>;
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

export const EXPRESS_TAG = "EXPRESS_DHL";
