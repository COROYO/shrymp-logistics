import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Order,
  type OrderInternalStatus,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { shopifyGraphQL } from "./client";
import { numericIdFromGid } from "./sync";
import { moneyDecimalToCents } from "./mappers";
import { mirrorInternalStatus } from "@/server/allocation/status-guard";
import { runWithTenantAsync } from "@/server/tenant/context";
import { normalizeShopId } from "@/server/tenant/id";

/**
 * Backfill existing orders from the shop into Firestore.
 *
 * Shopify webhooks only fire for NEW events — to bring orders that existed
 * before the webhook subscription was created (or that we somehow missed)
 * into our system, we pull them via the Admin GraphQL API.
 *
 * Strategy:
 *   - Page through `orders` with optional `query` filter (Shopify search syntax).
 *   - For each order, write/merge into `orders/{numericId}`, preserving any
 *     existing `internal_status` (so an already-PACKED order stays PACKED).
 *
 * Returns the number of mirrored orders.
 */
export type BackfillOrdersOptions = {
  shopId: string;
  /** Shopify search query string, e.g. "fulfillment_status:unfulfilled". Empty = all. */
  query?: string;
  /** Hard cap on pages, defensive against runaway. */
  maxPages?: number;
  pageSize?: number;
};

const PAGE_QUERY = /* GraphQL */ `
  query OrdersPage($cursor: String, $pageSize: Int!, $query: String) {
    orders(
      first: $pageSize
      after: $cursor
      sortKey: CREATED_AT
      reverse: true
      query: $query
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        tags
        createdAt
        updatedAt
        cancelledAt
        cancelReason
        displayFinancialStatus
        displayFulfillmentStatus
        currencyCode
        note
        email
        customer {
          id
          email
          firstName
          lastName
        }
        totalOutstandingSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        shippingLines(first: 5) {
          nodes {
            title
            code
          }
        }
        shippingAddress {
          firstName
          lastName
          company
          address1
          address2
          zip
          city
          country
          countryCodeV2
          phone
        }
        lineItems(first: 250) {
          nodes {
            id
            title
            quantity
            sku
            variant {
              id
            }
            lineItemGroup {
              id
              productId
              variantId
              variantSku
              title
              quantity
            }
          }
        }
      }
    }
  }
`;

type GqlMoneyBag = {
  shopMoney: { amount: string; currencyCode: string } | null;
} | null;

type GqlShippingLine = {
  title: string;
  code: string | null;
};

type GqlOrderNode = {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  currencyCode: string | null;
  note: string | null;
  email: string | null;
  customer: {
    id: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  totalOutstandingSet: GqlMoneyBag;
  currentTotalPriceSet: GqlMoneyBag;
  shippingLines: { nodes: GqlShippingLine[] };
  shippingAddress: GqlAddress | null;
  lineItems: { nodes: GqlLineItem[] };
};

type GqlAddress = {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  countryCodeV2: string | null;
  phone: string | null;
};

type GqlLineItem = {
  id: string;
  title: string;
  quantity: number;
  sku: string | null;
  variant: { id: string } | null;
  lineItemGroup: GqlLineItemGroup | null;
};

type GqlLineItemGroup = {
  id: string;
  productId: string | null;
  variantId: string | null;
  variantSku: string | null;
  title: string;
  quantity: number;
};

export async function backfillOrders(
  opts: BackfillOrdersOptions,
): Promise<{ mirroredCount: number; pages: number }> {
  const shopId = normalizeShopId(opts.shopId);
  return runWithTenantAsync(shopId, async () => {
  const db = adminDb();
  const pageSize = opts.pageSize ?? 50;
  const maxPages = opts.maxPages ?? 200;

  let cursor: string | null = null;
  let pages = 0;
  let mirroredCount = 0;
  let batch = db.batch();
  let opsInBatch = 0;
  const flushIf = async (force: boolean) => {
    if (opsInBatch > 0 && (force || opsInBatch >= 450)) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  };

  for (; pages < maxPages; pages++) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GqlOrderNode[];
      };
    } = await shopifyGraphQL(PAGE_QUERY, {
      cursor,
      pageSize,
      query: opts.query ?? null,
    });

    // Batch-read all existing docs for this page in one round-trip instead of
    // one `ref.get()` per order (N+1).
    const pageOrderIds = data.orders.nodes.map((n) => numericIdFromGid(n.id));
    const existingByeId = new Map<
      string,
      FirebaseFirestore.DocumentData | undefined
    >();
    if (pageOrderIds.length > 0) {
      const existingSnaps = await db.getAll(
        ...pageOrderIds.map((id) =>
          db.collection(Collections.Orders).doc(id),
        ),
      );
      for (const snap of existingSnaps) {
        existingByeId.set(snap.id, snap.exists ? snap.data() : undefined);
      }
    }

    for (const n of data.orders.nodes) {
      const orderId = numericIdFromGid(n.id);
      const ref = db.collection(Collections.Orders).doc(orderId);

      // Preserve existing internal_status so we don't reset SHIP/STOP/PACKED.
      const existingData = existingByeId.get(orderId);
      const prevStatus =
        (existingData?.internal_status as OrderInternalStatus | undefined) ??
        null;
      // LAGER tags are system-owned; preserve our confirmed push state across
      // mirrors so a Shopify webhook doesn't reset it and re-trigger a push.
      const prevLagerSynced =
        (existingData?.lager_tag_synced as "SHIP" | "STOP" | null | undefined) ??
        null;
      // Never let a Shopify re-sync change an existing order's internal status
      // (owned by the state machine) — only init a new order or move forward to
      // CANCELLED. Same invariant as the webhook mirror.
      const cancelled = !!n.cancelledAt;
      const internalStatus: OrderInternalStatus = mirrorInternalStatus(
        prevStatus,
        cancelled,
      );

      const doc: Omit<Order, "updated_at"> = {
        id: orderId,
        shop_id: shopId,
        shopify_gid: n.id,
        name: n.name,
        tags: n.tags ?? [],
        shipping_address: n.shippingAddress
          ? {
              first_name: n.shippingAddress.firstName,
              last_name: n.shippingAddress.lastName,
              company: n.shippingAddress.company,
              address1: n.shippingAddress.address1,
              address2: n.shippingAddress.address2,
              zip: n.shippingAddress.zip,
              city: n.shippingAddress.city,
              country: n.shippingAddress.country,
              country_code: n.shippingAddress.countryCodeV2,
              phone: n.shippingAddress.phone,
            }
          : null,
        shipping_method: (() => {
          const line = n.shippingLines.nodes[0];
          if (!line?.title) return null;
          return { title: line.title, code: line.code ?? null };
        })(),
        line_items: n.lineItems.nodes
          .filter((li) => li.variant?.id)
          .map((li) => {
            const vid = numericIdFromGid(li.variant!.id);
            const g = li.lineItemGroup;
            return {
              id: numericIdFromGid(li.id),
              variant_id: vid,
              variant_gid: li.variant!.id,
              qty: li.quantity,
              title: li.title,
              sku: li.sku ?? null,
              ...(g
                ? {
                    bundle: {
                      group_id: numericIdFromGid(g.id),
                      product_id: g.productId
                        ? numericIdFromGid(g.productId)
                        : null,
                      variant_id: g.variantId
                        ? numericIdFromGid(g.variantId)
                        : null,
                      variant_sku: g.variantSku ?? null,
                      title: g.title,
                      quantity: g.quantity,
                    },
                  }
                : {}),
            };
          }),
        shopify_financial_status: n.displayFinancialStatus ?? null,
        shopify_fulfillment_status: n.displayFulfillmentStatus ?? null,
        internal_status: internalStatus,
        lager_tag_synced: prevLagerSynced,
        cod_amount_cents:
          moneyDecimalToCents(
            n.totalOutstandingSet?.shopMoney?.amount ?? null,
          ) ??
          moneyDecimalToCents(
            n.currentTotalPriceSet?.shopMoney?.amount ?? null,
          ),
        currency:
          n.currencyCode ??
          n.totalOutstandingSet?.shopMoney?.currencyCode ??
          null,
        customer_note: n.note?.trim() ? n.note.trim() : null,
        ...(n.cancelledAt
          ? {
              cancelled_at: new Date(n.cancelledAt),
              cancel_reason: n.cancelReason ?? null,
            }
          : {}),
        customer: mapCustomerFromGql(n),
        total_price_cents: moneyDecimalToCents(
          n.currentTotalPriceSet?.shopMoney?.amount ?? null,
        ),
        created_at_shopify: new Date(n.createdAt),
      };

      // merge:true so a Shopify re-sync never wipes our internal state-machine
      // fields (packed_at, externally_fulfilled, tracking, picking_*, …) that
      // the Shopify payload doesn't carry.
      batch.set(
        ref,
        { ...doc, updated_at: FieldValue.serverTimestamp() },
        { merge: true },
      );
      opsInBatch++;
      mirroredCount++;

      if (opsInBatch >= 450) await flushIf(false);
    }

    if (!data.orders.pageInfo.hasNextPage) {
      cursor = null;
      break;
    }
    cursor = data.orders.pageInfo.endCursor;
  }

  await flushIf(true);

  log.info("orders_backfill_done", { mirroredCount, pages, query: opts.query, shopId });
  return { mirroredCount, pages };
  });
}

function mapCustomerFromGql(n: GqlOrderNode): {
  shopify_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
} | null {
  const c = n.customer;
  const email = c?.email ?? n.email ?? null;
  const first = c?.firstName ?? null;
  const last = c?.lastName ?? null;
  const sid = c?.id ? numericIdFromGid(c.id) : null;
  if (!sid && !email && !first && !last) return null;
  return {
    shopify_id: sid,
    email: email?.trim() ? email.trim().toLowerCase() : null,
    first_name: first,
    last_name: last,
  };
}
