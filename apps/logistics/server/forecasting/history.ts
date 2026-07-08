/**
 * Demand history builder — turns mirrored orders into a daily demand series
 * per variant.
 *
 * Two properties matter for forecast quality:
 *
 * 1. **Component-level demand.** Shopify Bundle parents are virtual (no
 *    stock); their components carry the real demand. Component line items
 *    are counted directly.
 *
 * 2. **Legacy bundle explosion.** Shops that used to sell "one basket = one
 *    SKU" and later unbundled would otherwise lose all pre-unbundling
 *    history for the component SKUs (the exact failure mode that breaks
 *    off-the-shelf forecasting tools). We learn each bundle's composition
 *    from observed orders (newest wins) and explode legacy parent-SKU line
 *    items into component demand, so components inherit the full history.
 *
 * Pure module — no Firestore, no clock. Callers pass orders + `nowMs`.
 */

const DAY_MS = 86_400_000;
const TZ = "Europe/Berlin";

/** Structural subset of OrderLineItem — keeps this module testable. */
export type HistoryLineItem = {
  variant_id: string;
  qty: number;
  bundle?: {
    group_id: string;
    variant_id: string | null;
    quantity: number;
  } | null;
};

/** Structural subset of Order. */
export type HistoryOrder = {
  internal_status: string;
  created_at_shopify: unknown;
  line_items: HistoryLineItem[];
};

/** parent variant id → (component variant id → units per 1 parent unit) */
export type BundleBom = Map<string, Map<string, number>>;

export type DemandHistory = {
  /** variant id → (dayNum → units). dayNum = UTC day number of the Berlin calendar day. */
  demandByVariant: Map<string, Map<number, number>>;
  bom: BundleBom;
  /** Variants whose series contains exploded legacy bundle demand. */
  explodedVariants: Set<string>;
  ordersCounted: number;
  endDayNum: number;
};

export function tsToMillis(ts: unknown): number | null {
  if (!ts) return null;
  const v = ts as { toMillis?(): number; toDate?(): Date; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof ts === "string") {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms;
  }
  if (ts instanceof Date) return ts.getTime();
  return null;
}

/** Berlin calendar day (YYYY-MM-DD) for an epoch ms. sv-SE renders ISO. */
export function berlinDayKey(ms: number): string {
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** Day number (UTC-based) of a YYYY-MM-DD key — DST-free calendar math. */
export function dayNumFromKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/**
 * Learn bundle compositions from observed orders. Component line items
 * share a `bundle.group_id`; `bundle.variant_id` is the parent variant and
 * `bundle.quantity` how many parent units the group covers. Newest order
 * wins so composition changes are picked up.
 */
export function learnBundleCompositions(orders: HistoryOrder[]): BundleBom {
  const sorted = [...orders].sort(
    (a, b) =>
      (tsToMillis(b.created_at_shopify) ?? 0) -
      (tsToMillis(a.created_at_shopify) ?? 0),
  );
  const bom: BundleBom = new Map();
  for (const order of sorted) {
    // group components per bundle instance on this order
    const groups = new Map<
      string,
      { parentVariantId: string; parentQty: number; comps: Map<string, number> }
    >();
    for (const li of order.line_items ?? []) {
      const b = li.bundle;
      if (!b || !b.variant_id || b.quantity <= 0) continue;
      let g = groups.get(b.group_id);
      if (!g) {
        g = { parentVariantId: b.variant_id, parentQty: b.quantity, comps: new Map() };
        groups.set(b.group_id, g);
      }
      g.comps.set(li.variant_id, (g.comps.get(li.variant_id) ?? 0) + li.qty);
    }
    for (const g of groups.values()) {
      if (bom.has(g.parentVariantId)) continue; // newest already recorded
      const perUnit = new Map<string, number>();
      for (const [variantId, qty] of g.comps) {
        perUnit.set(variantId, qty / g.parentQty);
      }
      if (perUnit.size > 0) bom.set(g.parentVariantId, perUnit);
    }
  }
  return bom;
}

export function buildDemandHistory(input: {
  orders: HistoryOrder[];
  nowMs: number;
  windowDays: number;
}): DemandHistory {
  const { orders, nowMs, windowDays } = input;
  const bom = learnBundleCompositions(orders);
  const endDayNum = dayNumFromKey(berlinDayKey(nowMs));
  const startDayNum = endDayNum - windowDays + 1;

  const demandByVariant = new Map<string, Map<number, number>>();
  const explodedVariants = new Set<string>();
  let ordersCounted = 0;

  const add = (variantId: string, dayNum: number, units: number) => {
    let series = demandByVariant.get(variantId);
    if (!series) {
      series = new Map();
      demandByVariant.set(variantId, series);
    }
    series.set(dayNum, (series.get(dayNum) ?? 0) + units);
  };

  for (const order of orders) {
    if (order.internal_status === "CANCELLED") continue;
    const ms = tsToMillis(order.created_at_shopify);
    if (ms == null) continue;
    const dayNum = dayNumFromKey(berlinDayKey(ms));
    if (dayNum < startDayNum || dayNum > endDayNum) continue;
    ordersCounted++;

    for (const li of order.line_items ?? []) {
      if (li.qty <= 0) continue;
      if (li.bundle) {
        // component of a bundle — real demand, count directly
        add(li.variant_id, dayNum, li.qty);
        continue;
      }
      const composition = bom.get(li.variant_id);
      if (composition) {
        // legacy sale of a bundle parent as plain SKU — explode into components
        for (const [componentId, perUnit] of composition) {
          add(componentId, dayNum, perUnit * li.qty);
          explodedVariants.add(componentId);
        }
        continue;
      }
      add(li.variant_id, dayNum, li.qty);
    }
  }

  return { demandByVariant, bom, explodedVariants, ordersCounted, endDayNum };
}

/**
 * Materialize a variant's sparse day map into a dense daily array starting
 * at its first sale (leading zero-days before launch would bias the level
 * estimate down). Index 0 = first sale day, last index = endDayNum.
 */
export function toDenseSeries(
  demand: Map<number, number>,
  endDayNum: number,
): number[] | null {
  let first = Infinity;
  for (const dayNum of demand.keys()) if (dayNum < first) first = dayNum;
  if (!Number.isFinite(first) || first > endDayNum) return null;
  const days = new Array<number>(endDayNum - first + 1).fill(0);
  for (const [dayNum, units] of demand) {
    if (dayNum >= first && dayNum <= endDayNum) days[dayNum - first] = units;
  }
  return days;
}
