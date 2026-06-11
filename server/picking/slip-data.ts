import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type Order,
  type Variant,
} from "@/server/firestore/schema";
import {
  getOrAssignLieferscheinNo,
  type LieferscheinRef,
} from "./lieferschein";
import {
  assignBatchesForOrder,
  orderAssignmentCoversLineItems,
} from "./assign-batches";
import { releaseUnshippableBatchAssignments } from "./release-invalid-assignments";
import { loadLagerConfig } from "@/server/lager/config";
import {
  isBatchAssignableForShipping,
  isBatchExpired,
} from "./batch-assignability";
import { log } from "@/lib/logger";

export type SlipAssignmentBlockReason =
  | "near_expiry"
  | "expired"
  | "incomplete";

export class SlipAssignmentBlockedError extends Error {
  readonly orderId: string;
  readonly reason: SlipAssignmentBlockReason;
  readonly minDaysBeforeExpiry: number;

  constructor(
    orderId: string,
    reason: SlipAssignmentBlockReason,
    minDaysBeforeExpiry: number,
  ) {
    super(`slip_assignment_blocked:${reason}`);
    this.name = "SlipAssignmentBlockedError";
    this.orderId = orderId;
    this.reason = reason;
    this.minDaysBeforeExpiry = minDaysBeforeExpiry;
  }
}

export type SlipAllocLine = {
  lineItemId: string;
  chargeNumber: string;
  expiryDateIso: string | null;
  qty: number;
};

export type SlipData = {
  order: Order;
  allocsByLi: Map<string, SlipAllocLine[]>;
  /**
   * Variant title per line item id (e.g. "300g"). Omitted / "Default Title"
   * variants resolve to null — those products have no real variant, so the
   * slip shouldn't show a redundant line.
   */
  variantTitleByLi: Map<string, string | null>;
  lieferschein: LieferscheinRef;
};

/** Shopify's placeholder title for products without real variants. */
const DEFAULT_VARIANT_TITLE = "Default Title";

/**
 * Load the data needed to render a packing slip (order + allocations + batch
 * metadata). Shared between the single-slip view and the bulk-slip view.
 *
 * Returns `null` if the order doesn't exist.
 */
export async function loadSlipData(orderId: string): Promise<SlipData | null> {
  const db = adminDb();
  const lagerCfg = await loadLagerConfig();

  const orderSnap = await db
    .collection(Collections.Orders)
    .doc(orderId)
    .get();
  if (!orderSnap.exists) return null;
  const order = orderSnap.data() as Order;

  await releaseUnshippableBatchAssignments(orderId);

  // Assign the oldest-MHD Chargen to this order BEFORE we read them. This is
  // the moment batches get pinned: pickers may work orders in arbitrary
  // sequence, but each slip always takes the oldest batch still on the shelf,
  // transactionally (no two slips can grab the same units). Idempotent on
  // reprint. Without a complete assignment we must not issue a Lieferschein.
  try {
    await assignBatchesForOrder(orderId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("assign_batches_expired_blocked")) {
      throw new SlipAssignmentBlockedError(
        orderId,
        "expired",
        lagerCfg.batch_min_days_before_expiry,
      );
    }
    if (msg.startsWith("assign_batches_near_expiry_blocked")) {
      throw new SlipAssignmentBlockedError(
        orderId,
        "near_expiry",
        lagerCfg.batch_min_days_before_expiry,
      );
    }
    if (msg.startsWith("assign_batches_insufficient")) {
      throw new SlipAssignmentBlockedError(
        orderId,
        "incomplete",
        lagerCfg.batch_min_days_before_expiry,
      );
    }
    log.warn("assign_batches_on_slip_failed", { orderId, error: msg });
  }

  const allocSnap = await db
    .collection(Collections.Allocations)
    .where("order_id", "==", orderId)
    .get();
  const allocs = allocSnap.docs.map((d) => d.data() as Allocation);

  if (!orderAssignmentCoversLineItems(order.line_items, allocs)) {
    throw new SlipAssignmentBlockedError(
      orderId,
      "incomplete",
      lagerCfg.batch_min_days_before_expiry,
    );
  }
  const batchIds = Array.from(new Set(allocs.map((a) => a.batch_id)));
  const batchSnaps = await Promise.all(
    batchIds.map((b) => db.collection(Collections.Batches).doc(b).get()),
  );
  const batchById = new Map<string, Batch>();
  for (const b of batchSnaps) {
    if (b.exists) batchById.set(b.id, b.data() as Batch);
  }

  const referenceDate = new Date();
  const minDays = lagerCfg.batch_min_days_before_expiry;
  const openAllocs = allocs.filter((a) => !a.consumed_at);
  for (const a of openAllocs) {
    const b = batchById.get(a.batch_id);
    if (
      !b ||
      !isBatchAssignableForShipping(b.expiry_date, minDays, referenceDate)
    ) {
      const reason =
        b && isBatchExpired(b.expiry_date, referenceDate)
          ? "expired"
          : "near_expiry";
      throw new SlipAssignmentBlockedError(orderId, reason, minDays);
    }
  }

  const allocsByLi = new Map<string, SlipAllocLine[]>();
  for (const a of allocs) {
    const b = batchById.get(a.batch_id);
    if (!b) continue;
    const exp = b.expiry_date as unknown as
      | { toDate?(): Date; seconds?: number }
      | undefined;
    let iso: string | null = null;
    if (exp && typeof (exp as { toDate?: unknown }).toDate === "function") {
      iso = (exp as { toDate(): Date }).toDate().toISOString().slice(0, 10);
    } else if (
      exp &&
      typeof (exp as { seconds?: number }).seconds === "number"
    ) {
      iso = new Date((exp as { seconds: number }).seconds * 1000)
        .toISOString()
        .slice(0, 10);
    }
    const entry: SlipAllocLine = {
      lineItemId: a.line_item_id,
      chargeNumber: b.charge_number,
      expiryDateIso: iso,
      qty: a.qty,
    };
    const list = allocsByLi.get(a.line_item_id);
    if (list) list.push(entry);
    else allocsByLi.set(a.line_item_id, [entry]);
  }

  // Variant titles per line item (for the slip's "Variante" column). Skip
  // Shopify's "Default Title" placeholder — those products have no variant.
  const variantIds = Array.from(
    new Set(order.line_items.map((li) => li.variant_id).filter(Boolean)),
  );
  const variantTitleById = new Map<string, string | null>();
  if (variantIds.length > 0) {
    const variantSnaps = await db.getAll(
      ...variantIds.map((id) => db.collection(Collections.Variants).doc(id)),
    );
    for (const v of variantSnaps) {
      if (!v.exists) continue;
      const title = (v.data() as Variant).title?.trim() || null;
      variantTitleById.set(
        v.id,
        title && title !== DEFAULT_VARIANT_TITLE ? title : null,
      );
    }
  }
  const variantTitleByLi = new Map<string, string | null>();
  for (const li of order.line_items) {
    variantTitleByLi.set(li.id, variantTitleById.get(li.variant_id) ?? null);
  }

  // Assign (or reuse) Lieferschein-Nr. AFTER reading the order so we have
  // the freshest doc. The helper is itself transactional — if the order
  // already has a number the existing one comes back, otherwise a new one
  // is allocated and written through.
  const lieferschein = await getOrAssignLieferscheinNo(orderId);
  // Reflect the assignment locally so the SlipBody renders the right value
  // on the FIRST print without an extra read round-trip.
  order.lieferschein_no = lieferschein.number;

  return { order, allocsByLi, variantTitleByLi, lieferschein };
}

export function tsToDate(t: unknown): Date | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate();
  if (typeof o.seconds === "number") return new Date(o.seconds * 1000);
  return null;
}
