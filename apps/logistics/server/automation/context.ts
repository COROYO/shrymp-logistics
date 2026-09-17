import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Order,
  type Product,
} from "@/server/firestore/schema";
import { ordersForShop } from "@/server/tenant/queries";
import { effectiveOrderTags } from "./order-tags";
import { loadLagerConfig } from "@/server/lager/config";
import { hasPriorityTag } from "@/server/allocation/types";

export type EvalContext = {
  order: {
    id: string;
    name: string;
    tags: string[];
    local_tags: string[];
    effective_tags: string[];
    total_price_cents: number;
    currency: string | null;
    shipping_country_code: string | null;
    shipping_method_code: string | null;
    shipping_method_title: string | null;
    skus: string[];
    variant_ids: string[];
    product_ids: string[];
    product_types: string[];
    has_priority_tag: boolean;
    priority_score: number;
    automation_hold: boolean;
    financial_status: string | null;
    has_fragile: boolean;
    has_oversized: boolean;
    has_hazmat: boolean;
  } | null;
  customer: {
    shopify_id: string | null;
    email: string | null;
    /** Lifetime spend in cents *excluding* the current order. */
    ltv_cents: number;
    /** Prior order count excluding the current order. */
    order_count: number;
  } | null;
  inbound: {
    variant_id: string | null;
    qty: number | null;
  } | null;
};

export type BuildContextInput = {
  shopId: string;
  order?: Order | null;
  /** Exclude this order id from LTV / order_count (the triggering order). */
  excludeOrderId?: string | null;
  inbound?: { variantId: string; qty: number } | null;
};

export async function buildEvalContext(
  input: BuildContextInput,
): Promise<EvalContext> {
  const order = input.order ?? null;
  const customer = order
    ? await loadCustomerMetrics(input.shopId, order, input.excludeOrderId ?? order.id)
    : null;

  let productFlags = {
    has_fragile: false,
    has_oversized: false,
    has_hazmat: false,
  };
  let productIds: string[] = [];
  let productTypes: string[] = [];

  if (order?.line_items?.length) {
    const variantIds = [
      ...new Set(order.line_items.map((li) => li.variant_id).filter(Boolean)),
    ];
    const db = adminDb();
    const variantSnaps = await Promise.all(
      variantIds.map((id) => db.collection(Collections.Variants).doc(id).get()),
    );
    productIds = [
      ...new Set(
        variantSnaps
          .map((s) => (s.exists ? (s.data()?.product_id as string) : null))
          .filter((x): x is string => !!x),
      ),
    ];
    if (productIds.length > 0) {
      const productSnaps = await Promise.all(
        productIds.map((id) =>
          db.collection(Collections.Products).doc(id).get(),
        ),
      );
      for (const ps of productSnaps) {
        if (!ps.exists) continue;
        const p = ps.data() as Product;
        if (p.product_type) productTypes.push(p.product_type);
        const f = p.fulfillment_flags;
        if (f?.fragile) productFlags.has_fragile = true;
        if (f?.oversized) productFlags.has_oversized = true;
        if (f?.hazmat) productFlags.has_hazmat = true;
      }
    }
  }

  const lagerCfg = await loadLagerConfig(input.shopId);
  const tags = order ? effectiveOrderTags(order) : [];

  return {
    order: order
      ? {
          id: order.id,
          name: order.name,
          tags: order.tags ?? [],
          local_tags: order.local_tags ?? [],
          effective_tags: tags,
          total_price_cents: order.total_price_cents ?? 0,
          currency: order.currency ?? null,
          shipping_country_code:
            order.shipping_address?.country_code ??
            order.shipping_address?.country ??
            null,
          shipping_method_code: order.shipping_method?.code ?? null,
          shipping_method_title: order.shipping_method?.title ?? null,
          skus: order.line_items
            .map((li) => li.sku)
            .filter((s): s is string => !!s),
          variant_ids: order.line_items.map((li) => li.variant_id),
          product_ids: productIds,
          product_types: productTypes,
          has_priority_tag: hasPriorityTag(tags, lagerCfg.priority_tags),
          priority_score: order.priority_score ?? 0,
          automation_hold: order.automation_hold ?? false,
          financial_status: order.shopify_financial_status,
          ...productFlags,
        }
      : null,
    customer,
    inbound: input.inbound
      ? { variant_id: input.inbound.variantId, qty: input.inbound.qty }
      : null,
  };
}

async function loadCustomerMetrics(
  shopId: string,
  order: Order,
  excludeOrderId: string,
): Promise<EvalContext["customer"]> {
  const c = order.customer;
  if (!c?.shopify_id && !c?.email) {
    return {
      shopify_id: null,
      email: null,
      ltv_cents: 0,
      order_count: 0,
    };
  }

  const db = adminDb();
  let q = ordersForShop(db, shopId);
  if (c.shopify_id) {
    q = q.where("customer.shopify_id", "==", c.shopify_id);
  } else {
    q = q.where("customer.email", "==", (c.email ?? "").toLowerCase());
  }

  const snap = await q.limit(500).get();
  let ltv = 0;
  let count = 0;
  for (const d of snap.docs) {
    if (d.id === excludeOrderId) continue;
    const o = d.data() as Order;
    if (o.internal_status === "CANCELLED") continue;
    count += 1;
    ltv += o.total_price_cents ?? 0;
  }

  return {
    shopify_id: c.shopify_id,
    email: c.email,
    ltv_cents: ltv,
    order_count: count,
  };
}
