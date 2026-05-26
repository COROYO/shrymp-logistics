/**
 * Pure-function types for the allocation algorithm.
 *
 * Intentionally decoupled from Firestore document shapes so that
 * the algorithm is trivially unit-testable and Firestore-agnostic.
 * The caller is responsible for mapping Firestore docs ↔ these types.
 */

export type BatchAvail = {
  id: string;
  variantId: string;
  chargeNumber: string;
  /** Epoch milliseconds. Earlier = sooner expiry = picked first (FEFO). */
  expiryDateMs: number;
  /** Currently available units (i.e. remaining_qty minus existing reservations). */
  remaining: number;
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

export type AllocLine = {
  lineItemId: string;
  batchId: string;
  qty: number;
};

export type Decision =
  | {
      orderId: string;
      status: "SHIP";
      allocations: AllocLine[];
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
  | "EMPTY_ORDER";

export type AllocationInput = {
  batches: BatchAvail[];
  orders: OrderInput[];
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
