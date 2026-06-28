import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  type Batch,
  type Order,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import {
  batchesForShop,
  ordersForShop,
  productsForShop,
  variantsForShop,
} from "@/server/tenant/queries";
import { getShop } from "@/server/tenant/shop";
import { DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY } from "@/lib/lager/defaults";
import { Timestamp } from "firebase-admin/firestore";

const DAY_MS = 86_400_000;
const TZ = "Europe/Berlin";
/** Variants with available stock at or below this count count as "low". */
const LOW_STOCK_THRESHOLD = 5;
/** How many trailing days the per-day throughput/revenue series spans. */
const SERIES_DAYS = 14;
/** Open backlog statuses we report counts for. */
const OPEN_STATUSES = ["NEW", "SHIP", "STOP", "PICKING"] as const;

export type DashboardDayPoint = {
  /** YYYY-MM-DD (Europe/Berlin). */
  dateIso: string;
  packed: number;
  orders: number;
  revenueCents: number;
};

export type DashboardStats = {
  generatedAtIso: string;
  currency: string;
  openOrders: {
    new: number;
    ship: number;
    stop: number;
    picking: number;
    total: number;
  };
  revenue: {
    todayCents: number;
    last7dCents: number;
    last30dCents: number;
    aovCents: number;
    ordersToday: number;
    orders7d: number;
    orders30d: number;
  };
  throughput: {
    packedToday: number;
    packed7d: number;
    packed30d: number;
    avgPickToPackMin: number | null;
    p90PickToPackMin: number | null;
    samples: number;
  };
  inventory: {
    skuCount: number;
    onHandUnits: number;
    reservedUnits: number;
    availableUnits: number;
    outOfStock: number;
    lowStock: number;
    valueCents: number;
  };
  batches: {
    enabled: boolean;
    active: number;
    expiringSoon: number;
    expired: number;
    minDaysBeforeExpiry: number;
  };
  series: DashboardDayPoint[];
};

function tsToMillis(ts: unknown): number | null {
  if (!ts) return null;
  const v = ts as { toMillis?(): number; toDate?(): Date; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof ts === "string") {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Europe/Berlin calendar day key (YYYY-MM-DD) for a given epoch ms. */
function berlinDayKey(ms: number): string {
  // sv-SE locale renders ISO-like YYYY-MM-DD.
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.ceil((p / 100) * sortedAsc.length) - 1,
  );
  return sortedAsc[Math.max(0, idx)] ?? null;
}

/**
 * Read-only KPI aggregation for the admin dashboard. Tuned for the low-volume
 * tenants this app serves: we pull a 30-day order window plus the full
 * variant/batch sets and fold everything in memory. No extra indexes needed
 * beyond the existing `shop_id + created_at_shopify` and `shop_id +
 * internal_status` ones.
 */
export async function loadDashboardStats(
  shopId: string,
): Promise<DashboardStats> {
  const db = adminDb();
  const now = Date.now();
  const since30dMs = now - 30 * DAY_MS;
  const since7dMs = now - 7 * DAY_MS;
  const todayKey = berlinDayKey(now);

  const [shop, recentSnap, openSnaps, variantSnap, productSnap, batchSnap] =
    await Promise.all([
      getShop(shopId),
      ordersForShop(db, shopId)
        .where("created_at_shopify", ">=", Timestamp.fromMillis(since30dMs))
        .orderBy("created_at_shopify", "desc")
        .limit(3000)
        .get(),
      Promise.all(
        OPEN_STATUSES.map((status) =>
          ordersForShop(db, shopId)
            .where("internal_status", "==", status)
            .get(),
        ),
      ),
      variantsForShop(db, shopId).get(),
      productsForShop(db, shopId).get(),
      batchesForShop(db, shopId).get(),
    ]);

  // ---------- open backlog (all dates, accurate even for stuck orders) ----------
  const openOrders = {
    new: openSnaps[0]?.size ?? 0,
    ship: openSnaps[1]?.size ?? 0,
    stop: openSnaps[2]?.size ?? 0,
    picking: openSnaps[3]?.size ?? 0,
    total: 0,
  };
  openOrders.total =
    openOrders.new + openOrders.ship + openOrders.stop + openOrders.picking;

  // ---------- revenue + throughput from the 30-day window ----------
  const recent = recentSnap.docs.map((d) => d.data() as Order);
  let currency = "EUR";

  let revToday = 0;
  let rev7d = 0;
  let rev30d = 0;
  let ordersToday = 0;
  let orders7d = 0;
  let orders30d = 0;
  let packedToday = 0;
  let packed7d = 0;
  let packed30d = 0;
  const durationsMin: number[] = [];

  const seriesMap = new Map<string, DashboardDayPoint>();
  for (let i = SERIES_DAYS - 1; i >= 0; i--) {
    const key = berlinDayKey(now - i * DAY_MS);
    seriesMap.set(key, { dateIso: key, packed: 0, orders: 0, revenueCents: 0 });
  }

  for (const o of recent) {
    if (o.currency) currency = o.currency;
    if (o.internal_status === "CANCELLED") continue;

    const createdMs = tsToMillis(o.created_at_shopify);
    const total = o.total_price_cents ?? 0;
    if (createdMs != null) {
      orders30d += 1;
      rev30d += total;
      if (createdMs >= since7dMs) {
        orders7d += 1;
        rev7d += total;
      }
      const createdKey = berlinDayKey(createdMs);
      if (createdKey === todayKey) {
        ordersToday += 1;
        revToday += total;
      }
      const sp = seriesMap.get(createdKey);
      if (sp) {
        sp.orders += 1;
        sp.revenueCents += total;
      }
    }

    const packedMs = tsToMillis(o.packed_at);
    if (packedMs != null) {
      packed30d += 1;
      if (packedMs >= since7dMs) packed7d += 1;
      const packedKey = berlinDayKey(packedMs);
      if (packedKey === todayKey) packedToday += 1;
      const sp = seriesMap.get(packedKey);
      if (sp) sp.packed += 1;

      const pickMs = tsToMillis(o.picking_started_at);
      if (pickMs != null && packedMs > pickMs) {
        durationsMin.push((packedMs - pickMs) / 60_000);
      }
    }
  }

  durationsMin.sort((a, b) => a - b);
  const avgPickToPackMin =
    durationsMin.length > 0
      ? durationsMin.reduce((s, n) => s + n, 0) / durationsMin.length
      : null;

  // ---------- inventory (exclude bundle parents — stock lives on components) ----------
  const products = new Map<string, Product>();
  for (const d of productSnap.docs) products.set(d.id, d.data() as Product);

  let skuCount = 0;
  let onHandUnits = 0;
  let reservedUnits = 0;
  let availableUnits = 0;
  let outOfStock = 0;
  let lowStock = 0;
  let valueCents = 0;

  for (const d of variantSnap.docs) {
    const v = d.data() as Variant;
    const product = products.get(v.product_id);
    if (product?.is_bundle) continue;
    skuCount += 1;
    const onHand = v.on_hand_total ?? 0;
    const reserved = v.reserved_total ?? 0;
    const available = Math.max(0, onHand - reserved);
    onHandUnits += onHand;
    reservedUnits += reserved;
    availableUnits += available;
    valueCents += onHand * (v.price_cents ?? 0);
    if (available <= 0) outOfStock += 1;
    else if (available <= LOW_STOCK_THRESHOLD) lowStock += 1;
  }

  // ---------- batches (Chargen / MHD) ----------
  const minDays =
    shop?.batch_min_days_before_expiry ?? DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY;
  const batchesEnabled = shop?.batches_enabled ?? true;
  const expiringCutoffMs = now + minDays * DAY_MS;
  let bActive = 0;
  let bExpiring = 0;
  let bExpired = 0;
  for (const d of batchSnap.docs) {
    const b = d.data() as Batch;
    const expMs = tsToMillis(b.expiry_date);
    const isExpired = b.status === "EXPIRED" || (expMs != null && expMs < now);
    if (isExpired) {
      bExpired += 1;
      continue;
    }
    if (b.status !== "ACTIVE" || (b.remaining_qty ?? 0) <= 0) continue;
    bActive += 1;
    if (expMs != null && expMs <= expiringCutoffMs) bExpiring += 1;
  }

  return {
    generatedAtIso: new Date(now).toISOString(),
    currency,
    openOrders,
    revenue: {
      todayCents: revToday,
      last7dCents: rev7d,
      last30dCents: rev30d,
      aovCents: orders30d > 0 ? Math.round(rev30d / orders30d) : 0,
      ordersToday,
      orders7d,
      orders30d,
    },
    throughput: {
      packedToday,
      packed7d,
      packed30d,
      avgPickToPackMin:
        avgPickToPackMin != null ? Math.round(avgPickToPackMin) : null,
      p90PickToPackMin: (() => {
        const p = percentile(durationsMin, 90);
        return p != null ? Math.round(p) : null;
      })(),
      samples: durationsMin.length,
    },
    inventory: {
      skuCount,
      onHandUnits,
      reservedUnits,
      availableUnits,
      outOfStock,
      lowStock,
      valueCents,
    },
    batches: {
      enabled: batchesEnabled,
      active: bActive,
      expiringSoon: bExpiring,
      expired: bExpired,
      minDaysBeforeExpiry: minDays,
    },
    series: Array.from(seriesMap.values()),
  };
}
