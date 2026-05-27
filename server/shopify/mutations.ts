import "server-only";
import { shopifyGraphQL, ShopifyGraphQLError } from "./client";

/**
 * Outbound Shopify Admin GraphQL mutations.
 *
 * Conventions:
 * - Order/Variant/InventoryItem IDs accepted as numeric strings or GIDs;
 *   helpers below coerce to GID form.
 * - userErrors are surfaced as ShopifyGraphQLError if non-empty.
 */

function toGid(prefix: string, idOrGid: string | number): string {
  const s = String(idOrGid);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/${prefix}/${s}`;
}

function throwIfUserErrors(
  scope: string,
  errs:
    | ReadonlyArray<{ message: string; field?: ReadonlyArray<string> | null }>
    | null
    | undefined,
): void {
  if (!errs || errs.length === 0) return;
  throw new ShopifyGraphQLError(
    `${scope} userErrors: ${errs.map((e) => e.message).join("; ")}`,
    errs.map((e) => ({
      message: e.message,
      path: e.field ? [...e.field] : undefined,
    })),
  );
}

// ----------------------- tagsAdd / tagsRemove -----------------------

const TAGS_ADD_MUTATION = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const TAGS_REMOVE_MUTATION = /* GraphQL */ `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function tagsAddOnOrder(
  orderIdOrGid: string | number,
  tags: string[],
): Promise<void> {
  if (tags.length === 0) return;
  const data = await shopifyGraphQL<{
    tagsAdd: {
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(TAGS_ADD_MUTATION, { id: toGid("Order", orderIdOrGid), tags });
  throwIfUserErrors("tagsAdd", data.tagsAdd.userErrors);
}

export async function tagsRemoveFromOrder(
  orderIdOrGid: string | number,
  tags: string[],
): Promise<void> {
  if (tags.length === 0) return;
  const data = await shopifyGraphQL<{
    tagsRemove: {
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(TAGS_REMOVE_MUTATION, { id: toGid("Order", orderIdOrGid), tags });
  throwIfUserErrors("tagsRemove", data.tagsRemove.userErrors);
}

// ----------------------- inventorySetOnHandQuantities -----------------------

// Since 2026-01 the `@idempotent` directive is required on this mutation.
// We pass a per-call key (UUID) so Shopify de-dupes retries — same key →
// same result, no double-write if a network hiccup makes us POST twice.
const INVENTORY_SET_MUTATION = /* GraphQL */ `
  mutation InventorySet(
    $input: InventorySetOnHandQuantitiesInput!
    $idempotencyKey: String!
  ) {
    inventorySetOnHandQuantities(input: $input)
      @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        createdAt
        changes {
          name
          delta
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export type InventorySetEntry = {
  inventoryItemId: string | number;
  locationId: string | number;
  quantity: number;
};

export async function inventorySetOnHand(
  reason: string,
  setQuantities: InventorySetEntry[],
  referenceDocumentUri?: string,
  /**
   * Idempotency key (required since API 2026-01). Should be stable across
   * retries of the *same* write — we use the outbox row id for that. If
   * omitted, a fresh UUID is generated (safe for one-shot callers).
   */
  idempotencyKey?: string,
): Promise<void> {
  if (setQuantities.length === 0) return;
  const data = await shopifyGraphQL<{
    inventorySetOnHandQuantities: {
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(INVENTORY_SET_MUTATION, {
    input: {
      reason,
      referenceDocumentUri,
      setQuantities: setQuantities.map((s) => ({
        inventoryItemId: toGid("InventoryItem", s.inventoryItemId),
        locationId: toGid("Location", s.locationId),
        quantity: s.quantity,
        // Required since 2026-01. `null` opts out of the compare-and-swap
        // (no optimistic-locking check against Shopify's previous value).
        // We're the source of truth, so a blind set is what we want.
        changeFromQuantity: null,
      })),
    },
    idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
  });
  throwIfUserErrors(
    "inventorySetOnHandQuantities",
    data.inventorySetOnHandQuantities.userErrors,
  );
}

// ----------------------- fulfillmentCreate -----------------------

const FULFILLMENT_ORDERS_QUERY = /* GraphQL */ `
  query FulfillmentOrdersForOrder($id: ID!) {
    order(id: $id) {
      id
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          lineItems(first: 100) {
            nodes {
              id
              remainingQuantity
              lineItem {
                id
                variant {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
`;

type FulfillmentOrderNode = {
  id: string;
  status: string;
  lineItems: {
    nodes: Array<{
      id: string;
      remainingQuantity: number;
      lineItem: { id: string; variant?: { id: string } | null } | null;
    }>;
  };
};

export async function getFulfillmentOrders(
  orderIdOrGid: string | number,
): Promise<FulfillmentOrderNode[]> {
  const data = await shopifyGraphQL<{
    order: { fulfillmentOrders: { nodes: FulfillmentOrderNode[] } } | null;
  }>(FULFILLMENT_ORDERS_QUERY, { id: toGid("Order", orderIdOrGid) });
  return data.order?.fulfillmentOrders.nodes ?? [];
}

const FULFILLMENT_CREATE_MUTATION = /* GraphQL */ `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export type FulfillmentTracking = {
  company?: string;
  number?: string;
  url?: string;
};

/**
 * Mark all *open* fulfillment-orders of a Shopify order as fulfilled,
 * optionally attaching tracking info.
 *
 * We send `fulfillmentOrderId` references with no explicit line-item subset:
 * Shopify interprets that as "fulfill everything remaining" — matching our
 * all-or-nothing policy.
 */
export async function fulfillmentCreateForOrder(
  orderIdOrGid: string | number,
  options: {
    tracking?: FulfillmentTracking;
    notifyCustomer?: boolean;
  } = {},
): Promise<{ fulfillmentId: string | null }> {
  const fos = await getFulfillmentOrders(orderIdOrGid);
  const open = fos.filter(
    (fo) => fo.status === "OPEN" || fo.status === "IN_PROGRESS",
  );
  if (open.length === 0) {
    return { fulfillmentId: null };
  }

  const data = await shopifyGraphQL<{
    fulfillmentCreate: {
      fulfillment: { id: string; status: string } | null;
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(FULFILLMENT_CREATE_MUTATION, {
    fulfillment: {
      notifyCustomer: options.notifyCustomer ?? true,
      trackingInfo: options.tracking ?? undefined,
      lineItemsByFulfillmentOrder: open.map((fo) => ({
        fulfillmentOrderId: fo.id,
      })),
    },
  });
  throwIfUserErrors("fulfillmentCreate", data.fulfillmentCreate.userErrors);
  return { fulfillmentId: data.fulfillmentCreate.fulfillment?.id ?? null };
}

// ----------------------- webhookSubscriptionCreate -----------------------

const WEBHOOK_SUBSCRIPTION_CREATE_MUTATION = /* GraphQL */ `
  mutation WebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: $webhookSubscription
    ) {
      webhookSubscription {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const WEBHOOK_SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query WebhookSubscriptions {
    webhookSubscriptions(first: 50) {
      nodes {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
`;

const WEBHOOK_SUBSCRIPTION_DELETE_MUTATION = /* GraphQL */ `
  mutation WebhookSubscriptionDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors {
        field
        message
      }
    }
  }
`;

export async function ensureWebhookSubscription(
  topic: string, // SCREAMING_SNAKE enum, e.g. "ORDERS_CREATE"
  callbackUrl: string,
): Promise<{ created: boolean; id: string }> {
  // First, look up existing subscriptions and reuse if URL+topic already match.
  const list = await shopifyGraphQL<{
    webhookSubscriptions: {
      nodes: Array<{
        id: string;
        topic: string;
        endpoint: { __typename: string; callbackUrl?: string };
      }>;
    };
  }>(WEBHOOK_SUBSCRIPTIONS_QUERY);

  const existing = list.webhookSubscriptions.nodes.find(
    (n) =>
      n.topic === topic &&
      n.endpoint.__typename === "WebhookHttpEndpoint" &&
      n.endpoint.callbackUrl === callbackUrl,
  );
  if (existing) return { created: false, id: existing.id };

  const data = await shopifyGraphQL<{
    webhookSubscriptionCreate: {
      webhookSubscription: { id: string } | null;
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(WEBHOOK_SUBSCRIPTION_CREATE_MUTATION, {
    topic,
    webhookSubscription: { callbackUrl, format: "JSON" },
  });
  throwIfUserErrors(
    "webhookSubscriptionCreate",
    data.webhookSubscriptionCreate.userErrors,
  );
  const id = data.webhookSubscriptionCreate.webhookSubscription?.id;
  if (!id) throw new Error("webhookSubscriptionCreate returned no id");
  return { created: true, id };
}

export async function deleteWebhookSubscription(id: string): Promise<void> {
  const data = await shopifyGraphQL<{
    webhookSubscriptionDelete: {
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(WEBHOOK_SUBSCRIPTION_DELETE_MUTATION, { id });
  throwIfUserErrors(
    "webhookSubscriptionDelete",
    data.webhookSubscriptionDelete.userErrors,
  );
}
