import "server-only";
import type { Allocation } from "@/server/firestore/schema";

/**
 * A "sale" allocation: stock was committed for this order and not reversed.
 * Released rows keep consumed_at for audit but must not block a re-ship.
 */
export function isActiveConsumption(a: Pick<Allocation, "consumed_at" | "released">): boolean {
  return !!a.consumed_at && !a.released;
}

/** True when this order already has at least one committed consumption. */
export function orderHasActiveConsumption(
  allocs: Pick<Allocation, "consumed_at" | "released">[],
): boolean {
  return allocs.some(isActiveConsumption);
}
