import {
  type Order,
  type OrderInternalStatus,
  type OrderLineItem,
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
  shipping_address?: ShopifyAddressPayload | null;
  line_items: ShopifyLineItemPayload[];
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

function mapLineItems(items: ShopifyLineItemPayload[]): OrderLineItem[] {
  return items
    .filter((li) => li.variant_id != null)
    .map((li) => ({
      id: String(li.id),
      // Firestore variants collection uses the numeric id as doc id;
      // see server/shopify/sync.ts (M3) for the contract.
      variant_id: String(li.variant_id),
      variant_gid: `gid://shopify/ProductVariant/${li.variant_id}`,
      qty: li.quantity,
      title: li.title,
      sku: li.sku ?? null,
    }));
}

/**
 * Map a Shopify webhook payload to a Firestore Order document.
 * `previousInternalStatus` is preserved so that re-receiving an update for an
 * order already in SHIP/STOP/PACKED state doesn't reset it to NEW.
 */
export function mapShopifyOrderToFirestore(
  payload: ShopifyOrderPayload,
  previousInternalStatus: OrderInternalStatus | null,
): Omit<Order, "updated_at"> {
  const cancelled = !!payload.cancelled_at;
  const internalStatus: OrderInternalStatus = cancelled
    ? "CANCELLED"
    : (previousInternalStatus ?? "NEW");

  return {
    id: String(payload.id),
    shopify_gid:
      payload.admin_graphql_api_id ?? `gid://shopify/Order/${payload.id}`,
    name: payload.name,
    tags: parseTags(payload.tags),
    shipping_address: mapAddress(payload.shipping_address),
    line_items: mapLineItems(payload.line_items),
    shopify_financial_status: payload.financial_status ?? null,
    shopify_fulfillment_status: payload.fulfillment_status ?? null,
    internal_status: internalStatus,
    created_at_shopify: new Date(payload.created_at),
  };
}
