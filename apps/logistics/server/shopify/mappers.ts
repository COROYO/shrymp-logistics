import {
  type Order,
  type OrderInternalStatus,
  type OrderLineItem,
  type OrderShippingMethod,
  type ShippingAddress,
} from "@/server/firestore/schema";

/**
 * Subset of the Shopify Order JSON we care about for mirroring.
 * We don't strictly validate — Shopify's payload is large and stable enough,
 * and any unexpected shape is logged downstream.
 */
export type ShopifyOrderPayload = {
  id: number; // numeric Shopify order id
  admin_graphql_api_id?: string;
  name: string; // "#1001"
  tags: string | string[]; // legacy CSV or array
  created_at: string;
  updated_at: string;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  /** Decimal string in shop currency, e.g. "49.90". */
  total_outstanding?: string | null;
  current_total_price?: string | null;
  currency?: string | null;
  shipping_address?: ShopifyAddressPayload | null;
  shipping_lines?: ShopifyShippingLinePayload[];
  /** Free-text customer note from checkout. */
  note?: string | null;
  /** Order "additional details" — checkout custom attributes (REST: array of {name, value}). */
  note_attributes?: { name?: string | null; value?: string | null }[] | null;
  email?: string | null;
  customer?: {
    id?: number | null;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  line_items: ShopifyLineItemPayload[];
};

export type ShopifyShippingLinePayload = {
  title?: string | null;
  code?: string | null;
};

export type ShopifyAddressPayload = {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  country_code?: string | null;
  phone?: string | null;
};

export type ShopifyLineItemPayload = {
  id: number;
  admin_graphql_api_id?: string;
  variant_id: number | null;
  title: string;
  quantity: number;
  sku?: string | null;
};

function parseTags(tags: string | string[]): string[] {
  if (Array.isArray(tags)) return tags.map((t) => t.trim()).filter(Boolean);
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Convert a Shopify decimal money string ("49.90") into integer cents (4990).
 * Returns null for null/undefined/empty/NaN inputs.
 */
export function moneyDecimalToCents(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function mapAddress(
  a: ShopifyAddressPayload | null | undefined,
): ShippingAddress | null {
  if (!a) return null;
  return {
    first_name: a.first_name ?? null,
    last_name: a.last_name ?? null,
    company: a.company ?? null,
    address1: a.address1 ?? null,
    address2: a.address2 ?? null,
    zip: a.zip ?? null,
    city: a.city ?? null,
    country: a.country ?? null,
    country_code: a.country_code ?? null,
    phone: a.phone ?? null,
  };
}

function numericTail(gid: string): string {
  const i = gid.lastIndexOf("/");
  return i < 0 ? gid : gid.slice(i + 1);
}

/** GraphQL line item node shared by the webhook re-fetch and the order backfill. */
export type ShopifyGqlLineItemNode = {
  id: string;
  title: string;
  quantity: number;
  sku: string | null;
  variant: { id: string } | null;
  lineItemGroup: {
    id: string;
    productId: string | null;
    variantId: string | null;
    variantSku: string | null;
    title: string;
    quantity: number;
  } | null;
};

/**
 * Map current-quantity GraphQL line items.
 * Items with `quantity <= 0` (removed via order edit) are dropped.
 * Items without a variant are kept as custom display lines — they are not
 * catalog products and must not enter allocation.
 */
export function orderLineItemsFromGql(
  nodes: ShopifyGqlLineItemNode[],
): OrderLineItem[] {
  const out: OrderLineItem[] = [];
  for (const li of nodes) {
    if (li.quantity <= 0) continue;
    const title = li.title?.trim();
    if (!title) continue;
    if (!li.variant?.id) {
      out.push({
        id: numericTail(li.id),
        variant_id: null,
        variant_gid: null,
        qty: li.quantity,
        title,
        sku: li.sku ?? null,
        custom: true,
      });
      continue;
    }
    const vid = numericTail(li.variant.id);
    const g = li.lineItemGroup;
    const item: OrderLineItem = {
      id: numericTail(li.id),
      variant_id: vid,
      variant_gid: li.variant.id,
      qty: li.quantity,
      title,
      sku: li.sku ?? null,
    };
    if (g) {
      item.bundle = {
        group_id: numericTail(g.id),
        product_id: g.productId ? numericTail(g.productId) : null,
        variant_id: g.variantId ? numericTail(g.variantId) : null,
        variant_sku: g.variantSku ?? null,
        title: g.title,
        quantity: g.quantity,
      };
    }
    out.push(item);
  }
  return out;
}

function mapLineItems(items: ShopifyLineItemPayload[]): OrderLineItem[] {
  const out: OrderLineItem[] = [];
  for (const li of items) {
    if (li.quantity <= 0) continue;
    const title = li.title?.trim();
    if (!title) continue;
    if (li.variant_id == null) {
      out.push({
        id: String(li.id),
        variant_id: null,
        variant_gid: null,
        qty: li.quantity,
        title,
        sku: li.sku ?? null,
        custom: true,
      });
      continue;
    }
    out.push({
      id: String(li.id),
      variant_id: String(li.variant_id),
      variant_gid: `gid://shopify/ProductVariant/${li.variant_id}`,
      qty: li.quantity,
      title,
      sku: li.sku ?? null,
    });
  }
  return out;
}

/** Map the first Shopify shipping line to our persisted shipping_method. */
export function mapShippingMethod(
  lines: ShopifyShippingLinePayload[] | null | undefined,
): OrderShippingMethod | null {
  const first = lines?.[0];
  if (!first?.title) return null;
  return {
    title: first.title,
    code: first.code ?? null,
  };
}

/**
 * Map a Shopify webhook payload to a Firestore Order document.
 * `previousInternalStatus` is preserved so that re-receiving an update for an
 * order already in SHIP/STOP/PACKED state doesn't reset it to NEW.
 */
export function mapShopifyOrderToFirestore(
  payload: ShopifyOrderPayload,
  shopId: string,
  previousInternalStatus: OrderInternalStatus | null,
  previousLagerTagSynced: "SHIP" | "STOP" | null = null,
): Omit<Order, "updated_at"> {
  const cancelled = !!payload.cancelled_at;
  const internalStatus: OrderInternalStatus = cancelled
    ? "CANCELLED"
    : (previousInternalStatus ?? "NEW");

  return {
    id: String(payload.id),
    shop_id: shopId,
    shopify_gid:
      payload.admin_graphql_api_id ?? `gid://shopify/Order/${payload.id}`,
    name: payload.name,
    tags: parseTags(payload.tags),
    shipping_address: mapAddress(payload.shipping_address),
    shipping_method: mapShippingMethod(payload.shipping_lines),
    line_items: mapLineItems(payload.line_items),
    shopify_financial_status: payload.financial_status ?? null,
    shopify_fulfillment_status: payload.fulfillment_status ?? null,
    internal_status: internalStatus,
    lager_tag_synced: previousLagerTagSynced,
    cod_amount_cents:
      moneyDecimalToCents(payload.total_outstanding) ??
      moneyDecimalToCents(payload.current_total_price),
    currency: payload.currency ?? null,
    customer_note: payload.note?.trim() ? payload.note.trim() : null,
    note_attributes: mapNoteAttributes(payload.note_attributes),
    customer: mapCustomerRef(payload),
    total_price_cents: moneyDecimalToCents(payload.current_total_price),
    local_tags: [],
    priority_score: 0,
    automation_hold: false,
    created_at_shopify: new Date(payload.created_at),
  };
}

function mapNoteAttributes(
  attrs: { name?: string | null; value?: string | null }[] | null | undefined,
): { name: string; value: string }[] | undefined {
  if (!Array.isArray(attrs)) return undefined;
  const out = attrs
    .map((a) => ({
      name: (a?.name ?? "").trim(),
      value: (a?.value ?? "").trim(),
    }))
    .filter((a) => a.name || a.value);
  return out.length > 0 ? out : undefined;
}

function mapCustomerRef(
  payload: ShopifyOrderPayload,
): { shopify_id: string | null; email: string | null; first_name: string | null; last_name: string | null } | null {
  const c = payload.customer;
  const email = c?.email ?? payload.email ?? null;
  const first = c?.first_name ?? null;
  const last = c?.last_name ?? null;
  const sid = c?.id != null ? String(c.id) : null;
  if (!sid && !email && !first && !last) return null;
  return {
    shopify_id: sid,
    email: email?.trim() ? email.trim().toLowerCase() : null,
    first_name: first,
    last_name: last,
  };
}
