import type { BatchAvail } from "./types";

/**
 * Build a per-variant pool of batches, sorted FEFO ascending:
 * earliest expiry first, then by charge number for a deterministic tiebreak.
 */
export function buildBatchPool(
  batches: readonly BatchAvail[],
): Map<string, BatchAvail[]> {
  const pool = new Map<string, BatchAvail[]>();
  for (const b of batches) {
    if (b.remaining <= 0) continue;
    const list = pool.get(b.variantId);
    if (list) list.push({ ...b });
    else pool.set(b.variantId, [{ ...b }]);
  }
  for (const list of pool.values()) {
    list.sort((a, b) => {
      if (a.expiryDateMs !== b.expiryDateMs) {
        return a.expiryDateMs - b.expiryDateMs;
      }
      return a.chargeNumber.localeCompare(b.chargeNumber);
    });
  }
  return pool;
}

/** Deep-clone a batch pool so a tentative allocation can be rolled back. */
export function clonePool(
  pool: Map<string, BatchAvail[]>,
): Map<string, BatchAvail[]> {
  const out = new Map<string, BatchAvail[]>();
  for (const [k, list] of pool) {
    out.set(
      k,
      list.map((b) => ({ ...b })),
    );
  }
  return out;
}
