import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";

/**
 * Read-only customer aggregation.
 *
 * We don't keep a `customers/` collection — instead we derive customer
 * records on the fly by grouping orders. Identity precedence:
 *
 *   1. `customer.shopify_id`  (stable, survives email changes)
 *   2. `customer.email`       (fallback when guest checkout without shopify id)
 *   3. fallback "unknown"     (orphan orders without any customer info)
 *
 * Cheap because we already paginate orders aggressively for the admin
 * `/admin/orders` view and the dataset is small (caviar shop, low volume).
 */

export type CustomerSummary = {
  /** Stable key used in URLs — either `s:<shopifyId>` or `e:<email>`. */
  key: string;
  shopifyId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Display name composed from first/last/email/"Gast". */
  displayName: string;
  orderCount: number;
  totalSpendCents: number;
  currency: string | null;
  lastOrderIso: string | null;
  firstOrderIso: string | null;
};

export type CustomerOrderRow = {
  id: string;
  name: string;
  internal_status: string;
  createdIso: string | null;
  totalCents: number | null;
  currency: string | null;
  itemCount: number;
  city: string | null;
  customer_note: string | null;
};

export type CustomerDetail = CustomerSummary & {
  orders: CustomerOrderRow[];
  /** Most recent shipping address — useful as "Standardadresse". */
  lastAddress: Order["shipping_address"];
};

function tsToIso(ts: unknown): string | null {
  if (!ts) return null;
  const v = ts as { toDate?(): Date; seconds?: number };
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000).toISOString();
  return null;
}

function keyFor(order: Order): string | null {
  const c = order.customer;
  if (c?.shopify_id) return `s:${c.shopify_id}`;
  if (c?.email) return `e:${c.email}`;
  return null;
}

function displayNameFor(c: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  return c.email ?? "Unbekannt";
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  const db = adminDb();
  // Cap at 1000 — well above expected volume; if we ever cross this we
  // need a proper /customers collection.
  const snap = await db
    .collection(Collections.Orders)
    .orderBy("created_at_shopify", "desc")
    .limit(1000)
    .get();

  const byKey = new Map<string, CustomerSummary>();

  for (const doc of snap.docs) {
    const o = doc.data() as Order;
    const key = keyFor(o);
    if (!key) continue; // skip orphan
    const c = o.customer!;
    const iso = tsToIso(o.created_at_shopify);
    const spend = o.total_price_cents ?? 0;

    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        shopifyId: c.shopify_id,
        email: c.email,
        firstName: c.first_name,
        lastName: c.last_name,
        displayName: displayNameFor(c),
        orderCount: 0,
        totalSpendCents: 0,
        currency: o.currency,
        lastOrderIso: iso,
        firstOrderIso: iso,
      };
      byKey.set(key, row);
    }
    row.orderCount += 1;
    row.totalSpendCents += spend;
    if (iso) {
      if (!row.lastOrderIso || iso > row.lastOrderIso) row.lastOrderIso = iso;
      if (!row.firstOrderIso || iso < row.firstOrderIso) row.firstOrderIso = iso;
    }
    // Prefer newest customer name (Shopify may have updated it).
    if (!row.firstName && c.first_name) row.firstName = c.first_name;
    if (!row.lastName && c.last_name) row.lastName = c.last_name;
    row.displayName = displayNameFor({
      first_name: row.firstName,
      last_name: row.lastName,
      email: row.email,
    });
  }

  return Array.from(byKey.values()).sort(
    (a, b) =>
      // by last order desc, then by total spend desc
      (b.lastOrderIso ?? "").localeCompare(a.lastOrderIso ?? "") ||
      b.totalSpendCents - a.totalSpendCents,
  );
}

export async function getCustomerDetail(
  key: string,
): Promise<CustomerDetail | null> {
  const db = adminDb();

  // Parse key
  const [kind, raw] = key.split(":", 2);
  if (!raw) return null;

  let q: FirebaseFirestore.Query = db.collection(Collections.Orders);
  if (kind === "s") {
    q = q.where("customer.shopify_id", "==", raw);
  } else if (kind === "e") {
    q = q.where("customer.email", "==", raw.toLowerCase());
  } else {
    return null;
  }
  const snap = await q.orderBy("created_at_shopify", "desc").limit(500).get();
  if (snap.empty) return null;

  const orders: CustomerOrderRow[] = [];
  let totalSpend = 0;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let email: string | null = null;
  let shopifyId: string | null = null;
  let currency: string | null = null;
  let firstOrderIso: string | null = null;
  let lastOrderIso: string | null = null;
  let lastAddress: Order["shipping_address"] = null;

  for (const d of snap.docs) {
    const o = d.data() as Order;
    const c = o.customer;
    if (c) {
      shopifyId ??= c.shopify_id;
      email ??= c.email;
      firstName ??= c.first_name;
      lastName ??= c.last_name;
    }
    currency ??= o.currency;
    const iso = tsToIso(o.created_at_shopify);
    if (iso) {
      if (!lastOrderIso || iso > lastOrderIso) lastOrderIso = iso;
      if (!firstOrderIso || iso < firstOrderIso) firstOrderIso = iso;
    }
    const cents = o.total_price_cents ?? 0;
    totalSpend += cents;
    if (!lastAddress && o.shipping_address) lastAddress = o.shipping_address;
    orders.push({
      id: o.id,
      name: o.name,
      internal_status: o.internal_status,
      createdIso: iso,
      totalCents: o.total_price_cents,
      currency: o.currency,
      itemCount: o.line_items.reduce((s, li) => s + li.qty, 0),
      city: o.shipping_address?.city ?? null,
      customer_note: o.customer_note,
    });
  }

  return {
    key,
    shopifyId,
    email,
    firstName,
    lastName,
    displayName: displayNameFor({
      first_name: firstName,
      last_name: lastName,
      email,
    }),
    orderCount: orders.length,
    totalSpendCents: totalSpend,
    currency,
    lastOrderIso,
    firstOrderIso,
    orders,
    lastAddress,
  };
}

export function formatMoneyCents(
  cents: number | null,
  currency: string | null,
): string {
  if (cents == null) return "—";
  const value = (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value} ${currency ?? "EUR"}`;
}
