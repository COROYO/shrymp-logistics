import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  PickRunSchema,
  type Order,
  type PickRun,
  type PickRunLine,
  type PickRunSlot,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import { pickRunsForShop } from "@/server/tenant/queries";
import { normalizeShopId } from "@/server/tenant/id";
import { runWithTenantAsync } from "@/server/tenant/context";
import { loadBinsForVariants } from "@/server/warehouse/bins";
import {
  cancelPicking,
  startPicking,
  TransitionError,
} from "@/server/picking/transitions";
import { log } from "@/lib/logger";

/** Hard cap on cart slots (totes) per run — matches typical cluster carts. */
export const MAX_PICK_RUN_SLOTS = 12;
const EXPRESS_TAG = "EXPRESS_DHL";

export class PickRunError extends Error {
  constructor(
    public readonly code:
      | "no_orders"
      | "no_eligible"
      | "too_many"
      | "not_found"
      | "wrong_status",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PickRunError";
  }
}

function tsToMs(ts: unknown): number {
  const t = ts as { toMillis?(): number; seconds?: number } | string | undefined;
  if (!t) return 0;
  if (typeof t === "string") return Date.parse(t) || 0;
  if (typeof (t as { toMillis?: unknown }).toMillis === "function") {
    return (t as { toMillis(): number }).toMillis();
  }
  if (typeof (t as { seconds?: number }).seconds === "number") {
    return (t as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function matchRunLine(lines: PickRunLine[], code: string): PickRunLine | null {
  const c = code.trim();
  if (!c) return null;
  const byBarcode = lines.find((l) => l.barcode && l.barcode === c);
  if (byBarcode) return byBarcode;
  const lc = c.toLowerCase();
  return lines.find((l) => l.sku && l.sku.toLowerCase() === lc) ?? null;
}

/**
 * Aggregate the line items of every order in the run into consolidated pick
 * positions. One variant collected once, then distributed across the cart
 * slots that need it (cluster picking). Sorted by bin code for an efficient
 * walking path.
 */
async function buildPickRunLines(
  slots: Pick<PickRunSlot, "slot" | "order_id">[],
  orderById: Map<string, Order>,
): Promise<PickRunLine[]> {
  const db = adminDb();
  const variantIds = new Set<string>();
  for (const s of slots) {
    const o = orderById.get(s.order_id);
    if (!o) continue;
    for (const li of o.line_items) if (li.variant_id) variantIds.add(li.variant_id);
  }
  const ids = [...variantIds];
  if (ids.length === 0) return [];

  const [variantSnaps, bins] = await Promise.all([
    db.getAll(...ids.map((id) => db.collection(Collections.Variants).doc(id))),
    loadBinsForVariants(ids),
  ]);
  const variantById = new Map<string, Variant>();
  for (const s of variantSnaps) if (s.exists) variantById.set(s.id, s.data() as Variant);

  const productIds = [
    ...new Set([...variantById.values()].map((v) => v.product_id).filter(Boolean)),
  ];
  const productById = new Map<string, Product>();
  if (productIds.length > 0) {
    const pSnaps = await db.getAll(
      ...productIds.map((id) => db.collection(Collections.Products).doc(id)),
    );
    for (const s of pSnaps) if (s.exists) productById.set(s.id, s.data() as Product);
  }

  const byVariant = new Map<string, PickRunLine>();
  for (const s of slots) {
    const o = orderById.get(s.order_id);
    if (!o) continue;
    // Shopify can split one product across several line items — sum per variant.
    const qtyByVariant = new Map<string, number>();
    for (const li of o.line_items) {
      if (!li.variant_id) continue;
      qtyByVariant.set(li.variant_id, (qtyByVariant.get(li.variant_id) ?? 0) + li.qty);
    }
    for (const [vid, qty] of qtyByVariant) {
      let line = byVariant.get(vid);
      if (!line) {
        const v = variantById.get(vid);
        const p = v ? productById.get(v.product_id) : undefined;
        const bin = bins.get(vid);
        const li = o.line_items.find((l) => l.variant_id === vid);
        line = {
          variant_id: vid,
          title: p?.title ?? li?.title ?? "—",
          variant_title: v?.title ?? "",
          sku: li?.sku ?? v?.sku ?? null,
          barcode: v?.barcode ?? null,
          bin_code: bin?.code ?? null,
          bin_name: bin?.name ?? null,
          total_qty: 0,
          slots: [],
        };
        byVariant.set(vid, line);
      }
      line.total_qty += qty;
      line.slots.push({ slot: s.slot, order_id: s.order_id, qty, picked: 0 });
    }
  }

  const lines = [...byVariant.values()];
  for (const l of lines) l.slots.sort((a, b) => a.slot - b.slot);
  lines.sort((a, b) => {
    const byBin = (a.bin_code ?? "~").localeCompare(b.bin_code ?? "~", "de");
    if (byBin !== 0) return byBin;
    return a.title.localeCompare(b.title, "de");
  });
  return lines;
}

export type CreatePickRunResult = {
  runId: string;
  included: string[];
  skipped: { orderId: string; reason: string }[];
};

/**
 * Start a multi-order pick run from a set of SHIP orders. Each order is moved
 * to PICKING and assigned a cart slot (express first, then oldest). Orders that
 * aren't eligible are reported in `skipped` (best-effort, like the bulk pack).
 */
export async function createPickRun(
  orderIds: string[],
  userId: string,
  accessibleShops: string[],
): Promise<CreatePickRunResult> {
  const unique = [...new Set(orderIds.filter(Boolean))];
  if (unique.length === 0) throw new PickRunError("no_orders");

  const db = adminDb();
  const snaps = await db.getAll(
    ...unique.map((id) => db.collection(Collections.Orders).doc(id)),
  );

  const skipped: { orderId: string; reason: string }[] = [];
  const valid: Order[] = [];
  let shopId: string | null = null;

  for (const snap of snaps) {
    if (!snap.exists) {
      skipped.push({ orderId: snap.id, reason: "not_found" });
      continue;
    }
    const o = snap.data() as Order;
    const sid = normalizeShopId(o.shop_id ?? "");
    if (!sid || !accessibleShops.includes(sid)) {
      skipped.push({ orderId: snap.id, reason: "not_found" });
      continue;
    }
    if (shopId === null) shopId = sid;
    if (sid !== shopId) {
      skipped.push({ orderId: snap.id, reason: "cross_shop" });
      continue;
    }
    valid.push(o);
  }

  if (!shopId || valid.length === 0) throw new PickRunError("no_eligible");

  // Orders already booked into another active run must not be double-picked.
  const booked = await loadBookedOrderIds(shopId);

  // SHIP → move to PICKING; PICKING (not yet in a run) → take as-is.
  const candidates: { order: Order; needsStart: boolean }[] = [];
  for (const o of valid) {
    if (booked.has(o.id)) {
      skipped.push({ orderId: o.id, reason: "already_in_run" });
      continue;
    }
    if (o.internal_status === "SHIP") {
      candidates.push({ order: o, needsStart: true });
    } else if (o.internal_status === "PICKING") {
      candidates.push({ order: o, needsStart: false });
    } else {
      skipped.push({ orderId: o.id, reason: `wrong_status:${o.internal_status}` });
    }
  }

  if (candidates.length === 0) throw new PickRunError("no_eligible");
  if (candidates.length > MAX_PICK_RUN_SLOTS) throw new PickRunError("too_many");

  candidates.sort((a, b) => {
    const ea = a.order.tags.includes(EXPRESS_TAG);
    const eb = b.order.tags.includes(EXPRESS_TAG);
    if (ea !== eb) return ea ? -1 : 1;
    return tsToMs(a.order.created_at_shopify) - tsToMs(b.order.created_at_shopify);
  });

  const activeShop = shopId;
  return runWithTenantAsync(activeShop, async () => {
    const started: Order[] = [];
    for (const c of candidates) {
      if (!c.needsStart) {
        // Already in PICKING (single-order flow or earlier) — take as-is.
        started.push(c.order);
        continue;
      }
      try {
        await startPicking(c.order.id, userId);
        started.push(c.order);
      } catch (e) {
        skipped.push({
          orderId: c.order.id,
          reason: e instanceof TransitionError ? e.message : "start_failed",
        });
      }
    }
    if (started.length === 0) throw new PickRunError("no_eligible");

    const slots: PickRunSlot[] = started.map((o, i) => ({
      slot: i + 1,
      order_id: o.id,
      order_name: o.name,
      express: o.tags.includes(EXPRESS_TAG),
    }));
    const orderById = new Map(started.map((o) => [o.id, o]));

    let lines: PickRunLine[];
    try {
      lines = await buildPickRunLines(slots, orderById);
    } catch (e) {
      // Don't leave orders stuck in PICKING without a run.
      for (const o of started) {
        await cancelPicking(o.id, userId).catch(() => undefined);
      }
      throw e;
    }

    const ref = db.collection(Collections.PickRuns).doc();
    const doc = PickRunSchema.parse({
      id: ref.id,
      shop_id: activeShop,
      status: "PICKING",
      slots,
      lines,
      order_ids: started.map((o) => o.id),
      created_at: new Date(),
      created_by_uid: userId,
      updated_at: new Date(),
    });
    await ref.set({
      ...doc,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    log.info("pick_run_created", {
      shopId: activeShop,
      runId: ref.id,
      orders: started.length,
      skipped: skipped.length,
    });
    return { runId: ref.id, included: started.map((o) => o.id), skipped };
  });
}

export async function loadPickRun(runId: string): Promise<PickRun | null> {
  const snap = await adminDb().collection(Collections.PickRuns).doc(runId).get();
  if (!snap.exists) return null;
  return snap.data() as PickRun;
}

export type ScanPickResult =
  | {
      ok: true;
      variantId: string;
      slot: number;
      orderName: string;
      title: string;
      lineComplete: boolean;
      runComplete: boolean;
      totalPicked: number;
      totalQty: number;
    }
  | { ok: false; reason: "not_picking" | "wrong_item" | "over_pick"; code: string };

/**
 * Record one scanned unit. Resolves the matching pick line (barcode → sku) and
 * drops it into the first slot that still needs it, returning a "put to slot"
 * hint for the picker. Runs in a transaction so concurrent devices stay sane.
 */
export async function recordPickScan(
  runId: string,
  rawCode: string,
): Promise<ScanPickResult> {
  const code = rawCode.trim();
  if (!code) return { ok: false, reason: "wrong_item", code: rawCode };

  const db = adminDb();
  const ref = db.collection(Collections.PickRuns).doc(runId);
  return db.runTransaction<ScanPickResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "wrong_item", code };
    const run = snap.data() as PickRun;
    if (run.status !== "PICKING") return { ok: false, reason: "not_picking", code };

    const line = matchRunLine(run.lines, code);
    if (!line) return { ok: false, reason: "wrong_item", code };
    const target = line.slots.find((s) => s.picked < s.qty);
    if (!target) return { ok: false, reason: "over_pick", code };

    target.picked += 1;
    tx.update(ref, { lines: run.lines, updated_at: FieldValue.serverTimestamp() });

    const slotMeta = run.slots.find((s) => s.slot === target.slot);
    const lineComplete = line.slots.every((s) => s.picked >= s.qty);
    const runComplete = run.lines.every((l) =>
      l.slots.every((s) => s.picked >= s.qty),
    );
    const totalPicked = line.slots.reduce((n, s) => n + s.picked, 0);
    return {
      ok: true,
      variantId: line.variant_id,
      slot: target.slot,
      orderName: slotMeta?.order_name ?? "",
      title: line.title,
      lineComplete,
      runComplete,
      totalPicked,
      totalQty: line.total_qty,
    };
  });
}

export type AdjustResult = { ok: boolean; reason?: string };

/** Manual +/- on a single slot of a line (correction / short-pick override). */
export async function adjustPickSlot(
  runId: string,
  variantId: string,
  slot: number,
  delta: number,
): Promise<AdjustResult> {
  const db = adminDb();
  const ref = db.collection(Collections.PickRuns).doc(runId);
  return db.runTransaction<AdjustResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "not_found" };
    const run = snap.data() as PickRun;
    if (run.status !== "PICKING") return { ok: false, reason: "not_picking" };
    const line = run.lines.find((l) => l.variant_id === variantId);
    if (!line) return { ok: false, reason: "no_line" };
    const s = line.slots.find((x) => x.slot === slot);
    if (!s) return { ok: false, reason: "no_slot" };
    s.picked = Math.max(0, Math.min(s.qty, s.picked + delta));
    tx.update(ref, { lines: run.lines, updated_at: FieldValue.serverTimestamp() });
    return { ok: true };
  });
}

export async function completePicking(runId: string): Promise<AdjustResult> {
  const db = adminDb();
  const ref = db.collection(Collections.PickRuns).doc(runId);
  return db.runTransaction<AdjustResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "not_found" };
    const run = snap.data() as PickRun;
    if (run.status === "PACKING") return { ok: true };
    if (run.status !== "PICKING") return { ok: false, reason: "wrong_status" };
    const complete = run.lines.every((l) =>
      l.slots.every((s) => s.picked >= s.qty),
    );
    if (!complete) return { ok: false, reason: "incomplete" };
    tx.update(ref, {
      status: "PACKING",
      completed_picking_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });
}

export async function cancelPickRun(
  runId: string,
  userId: string,
): Promise<AdjustResult> {
  const run = await loadPickRun(runId);
  if (!run) return { ok: false, reason: "not_found" };
  if (run.status !== "PICKING") return { ok: false, reason: "wrong_status" };
  await runWithTenantAsync(normalizeShopId(run.shop_id), async () => {
    for (const s of run.slots) {
      await cancelPicking(s.order_id, userId).catch(() => undefined);
    }
  });
  await adminDb().collection(Collections.PickRuns).doc(runId).update({
    status: "CANCELLED",
    updated_at: FieldValue.serverTimestamp(),
  });
  log.info("pick_run_cancelled", { runId, shopId: run.shop_id });
  return { ok: true };
}

/** Flip the run to DONE once every order has reached PACKED. Idempotent. */
export async function finishRunIfPacked(
  runId: string,
): Promise<{ ok: boolean; done: boolean; reason?: string }> {
  const db = adminDb();
  const run = await loadPickRun(runId);
  if (!run) return { ok: false, done: false, reason: "not_found" };
  if (run.status === "DONE") return { ok: true, done: true };
  if (run.status !== "PACKING") return { ok: false, done: false, reason: "wrong_status" };
  if (run.order_ids.length === 0) return { ok: true, done: false };

  const snaps = await db.getAll(
    ...run.order_ids.map((id) => db.collection(Collections.Orders).doc(id)),
  );
  const allPacked = snaps.every(
    (s) => s.exists && (s.data() as Order).internal_status === "PACKED",
  );
  if (!allPacked) return { ok: true, done: false };

  await db.collection(Collections.PickRuns).doc(runId).update({
    status: "DONE",
    done_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  log.info("pick_run_done", { runId, shopId: run.shop_id });
  return { ok: true, done: true };
}

export type PickRunSummary = {
  id: string;
  status: PickRun["status"];
  orderCount: number;
  pickedUnits: number;
  totalUnits: number;
  createdIso: string;
  orderNames: string[];
};

function summarize(run: PickRun): PickRunSummary {
  let picked = 0;
  let total = 0;
  for (const l of run.lines) {
    for (const s of l.slots) {
      picked += Math.min(s.picked, s.qty);
      total += s.qty;
    }
  }
  return {
    id: run.id,
    status: run.status,
    orderCount: run.slots.length,
    pickedUnits: picked,
    totalUnits: total,
    createdIso: new Date(tsToMs(run.created_at)).toISOString(),
    orderNames: run.slots.map((s) => s.order_name),
  };
}

/** Raw active run docs (PICKING / PACKING) for a shop. */
async function loadActiveRunDocs(shopId: string): Promise<PickRun[]> {
  const db = adminDb();
  try {
    const snap = await pickRunsForShop(db, shopId)
      .where("status", "in", ["PICKING", "PACKING"])
      .get();
    return snap.docs.map((d) => d.data() as PickRun);
  } catch {
    // Composite index not deployed yet — fall back to a shop-only read and
    // filter in memory so the picking page never hard-fails.
    const snap = await pickRunsForShop(db, shopId).get();
    return snap.docs
      .map((d) => d.data() as PickRun)
      .filter((r) => r.status === "PICKING" || r.status === "PACKING");
  }
}

/** Order ids already booked into an active run — must not be double-picked. */
async function loadBookedOrderIds(shopId: string): Promise<Set<string>> {
  const runs = await loadActiveRunDocs(shopId);
  const booked = new Set<string>();
  for (const r of runs) for (const id of r.order_ids) booked.add(id);
  return booked;
}

/** Active runs (PICKING / PACKING) for the queue banner, newest first. */
export async function loadActivePickRuns(
  shopId: string,
): Promise<PickRunSummary[]> {
  const runs = await loadActiveRunDocs(shopId);
  return runs
    .map(summarize)
    .sort((a, b) => b.createdIso.localeCompare(a.createdIso));
}
