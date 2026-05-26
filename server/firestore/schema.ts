import { z } from "zod";

/**
 * Firestore document schemas (Zod).
 *
 * Conventions:
 * - Timestamps are stored as Firestore `Timestamp` server-side; for type purposes
 *   we accept `Date | { toMillis(): number } | string` and normalize in converters.
 * - All "id" fields here are the in-document copy of the document ID
 *   (kept duplicated for query convenience).
 */

const FirestoreTimestamp = z
  .union([
    z.date(),
    z.string().datetime(),
    z.object({ toMillis: z.function() }).passthrough(),
    z.object({ seconds: z.number(), nanoseconds: z.number() }).passthrough(),
  ])
  .describe("Firestore Timestamp or ISO date string");

// ---------- products / variants ----------

export const ProductSchema = z.object({
  id: z.string(),
  shopify_gid: z.string(), // "gid://shopify/Product/123"
  title: z.string(),
  handle: z.string(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
  updated_at_shopify: FirestoreTimestamp.optional(),
  synced_at: FirestoreTimestamp,
});

export const VariantSchema = z.object({
  id: z.string(),
  product_id: z.string(),
  shopify_gid: z.string(),
  inventory_item_gid: z.string(),
  sku: z.string().nullable().default(null),
  title: z.string(),
  on_hand_total: z.number().int().nonnegative().default(0),
  reserved_total: z.number().int().nonnegative().default(0),
  available: z.number().int().default(0),
  updated_at: FirestoreTimestamp,
});

// ---------- batches (Chargen) ----------

export const BatchStatusSchema = z.enum(["ACTIVE", "DEPLETED", "EXPIRED"]);

export const BatchSchema = z.object({
  id: z.string(),
  variant_id: z.string(),
  charge_number: z.string(),
  expiry_date: FirestoreTimestamp,
  initial_qty: z.number().int().positive(),
  remaining_qty: z.number().int().nonnegative(),
  received_at: FirestoreTimestamp,
  received_by_uid: z.string(),
  status: BatchStatusSchema.default("ACTIVE"),
  notes: z.string().optional(),
});

// ---------- orders ----------

export const OrderInternalStatusSchema = z.enum([
  "NEW",
  "SHIP",
  "STOP",
  "PACKED",
  "CANCELLED",
]);

export const OrderLineItemSchema = z.object({
  id: z.string(), // shopify line item id
  variant_id: z.string(), // firestore variant doc id
  variant_gid: z.string(),
  qty: z.number().int().positive(),
  title: z.string(),
  sku: z.string().nullable().default(null),
});

export const ShippingAddressSchema = z.object({
  first_name: z.string().nullable().default(null),
  last_name: z.string().nullable().default(null),
  company: z.string().nullable().default(null),
  address1: z.string().nullable().default(null),
  address2: z.string().nullable().default(null),
  zip: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
  country_code: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
});

export const OrderSchema = z.object({
  id: z.string(), // doc id = numeric shopify order id as string
  shopify_gid: z.string(),
  name: z.string(), // "#1001"
  tags: z.array(z.string()).default([]),
  shipping_address: ShippingAddressSchema.nullable().default(null),
  line_items: z.array(OrderLineItemSchema),
  shopify_financial_status: z.string().nullable().default(null),
  shopify_fulfillment_status: z.string().nullable().default(null),
  internal_status: OrderInternalStatusSchema.default("NEW"),
  stop_reason: z.string().optional(),
  allocation_run_id: z.string().optional(),
  created_at_shopify: FirestoreTimestamp,
  updated_at: FirestoreTimestamp,
});

// ---------- allocations ----------

export const AllocationSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  line_item_id: z.string(),
  variant_id: z.string(),
  batch_id: z.string(),
  qty: z.number().int().positive(),
  run_id: z.string(),
  created_at: FirestoreTimestamp,
  consumed_at: FirestoreTimestamp.optional(),
});

// ---------- inventory movements (audit log) ----------

export const MovementTypeSchema = z.enum([
  "INBOUND", // Wareneingang
  "RESERVE", // bei Allocation
  "RELEASE", // Reservierung aufgehoben (Storno, Re-Allocation)
  "CONSUME", // bei Packing-Bestätigung
  "ADJUSTMENT", // manuelle Korrektur
  "EXTERNAL_DRIFT", // detected via INVENTORY_LEVELS_UPDATE webhook
]);

export const MovementRefSchema = z.object({
  kind: z.enum(["ORDER", "MANUAL", "EXTERNAL", "ALLOCATION_RUN"]),
  id: z.string(),
});

export const InventoryMovementSchema = z.object({
  id: z.string(),
  type: MovementTypeSchema,
  batch_id: z.string().nullable().default(null),
  variant_id: z.string(),
  qty: z.number().int(), // signed (e.g. -5 for CONSUME, +5 for INBOUND)
  ref: MovementRefSchema,
  user_id: z.string().nullable().default(null),
  note: z.string().optional(),
  created_at: FirestoreTimestamp,
});

// ---------- users ----------

export const UserRoleSchema = z.enum(["ADMIN", "LAGER"]);

export const UserSchema = z.object({
  id: z.string(), // = Firebase Auth uid
  email: z.string().email(),
  display_name: z.string().nullable().default(null),
  role: UserRoleSchema,
  created_at: FirestoreTimestamp,
  disabled: z.boolean().default(false),
});

// ---------- allocation runs ----------

export const AllocationRunStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMMITTED",
  "FAILED",
]);

export const AllocationRunSchema = z.object({
  id: z.string(),
  triggered_by: z.enum([
    "ORDER_CREATED",
    "ORDER_UPDATED",
    "ORDER_CANCELLED",
    "INBOUND",
    "PACKING_DONE",
    "MANUAL",
  ]),
  trigger_event_id: z.string().optional(),
  started_at: FirestoreTimestamp,
  finished_at: FirestoreTimestamp.optional(),
  status: AllocationRunStatusSchema.default("PENDING"),
  stats: z
    .object({
      ship_count: z.number().int().nonnegative(),
      stop_count: z.number().int().nonnegative(),
      duration_ms: z.number().int().nonnegative(),
    })
    .optional(),
  error: z.string().optional(),
});

// ---------- webhook dedup ----------

export const WebhookEventSchema = z.object({
  id: z.string(), // X-Shopify-Webhook-Id
  topic: z.string(),
  received_at: FirestoreTimestamp,
  processed_at: FirestoreTimestamp.optional(),
  body_hash: z.string().optional(),
  status: z.enum(["RECEIVED", "PROCESSED", "FAILED"]).default("RECEIVED"),
  error: z.string().optional(),
});

// ---------- shopify outbox (failed mutations retry queue) ----------

export const ShopifyOutboxSchema = z.object({
  id: z.string(),
  op: z.enum([
    "TAGS_ADD",
    "TAGS_REMOVE",
    "FULFILLMENT_CREATE",
    "INVENTORY_SET",
  ]),
  payload: z.record(z.string(), z.unknown()),
  attempts: z.number().int().nonnegative().default(0),
  last_error: z.string().optional(),
  next_retry_at: FirestoreTimestamp,
  created_at: FirestoreTimestamp,
  done_at: FirestoreTimestamp.optional(),
});

// ---------- shopify config (singleton in config/shopify_meta) ----------

export const ShopifyConfigSchema = z.object({
  shop_domain: z.string(), // e.g. "monolithcaviar.myshopify.com"
  location_gid: z.string().optional(), // "gid://shopify/Location/123"
  api_version: z.string().default("2026-04"),
  updated_at: FirestoreTimestamp,
});

// Stored offline access token from the OAuth install. Kept separately from
// `shopify_meta` so it can have stricter security rules / IAM if needed.
// Singleton id: `config/shopify_token`.
export const ShopifyTokenSchema = z.object({
  shop_domain: z.string(),
  access_token: z.string(),
  scope: z.string(), // comma-separated scopes Shopify granted
  installed_at: FirestoreTimestamp,
  installed_by_uid: z.string().nullable().default(null),
});

// ---------- exported types ----------

export type Product = z.infer<typeof ProductSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type Batch = z.infer<typeof BatchSchema>;
export type BatchStatus = z.infer<typeof BatchStatusSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type OrderInternalStatus = z.infer<typeof OrderInternalStatusSchema>;
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;
export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;
export type Allocation = z.infer<typeof AllocationSchema>;
export type InventoryMovement = z.infer<typeof InventoryMovementSchema>;
export type MovementType = z.infer<typeof MovementTypeSchema>;
export type User = z.infer<typeof UserSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type AllocationRun = z.infer<typeof AllocationRunSchema>;
export type AllocationRunStatus = z.infer<typeof AllocationRunStatusSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type ShopifyOutbox = z.infer<typeof ShopifyOutboxSchema>;
export type ShopifyConfig = z.infer<typeof ShopifyConfigSchema>;
export type ShopifyToken = z.infer<typeof ShopifyTokenSchema>;

// ---------- collection name constants ----------

export const Collections = {
  Products: "products",
  Variants: "variants",
  Batches: "batches",
  Orders: "orders",
  Allocations: "allocations",
  InventoryMovements: "inventory_movements",
  Users: "users",
  AllocationRuns: "allocation_runs",
  WebhookEvents: "webhook_events",
  ShopifyOutbox: "shopify_outbox",
  Config: "config",
} as const;

export const ConfigDocs = {
  ShopifyMeta: "shopify_meta",
  ShopifyToken: "shopify_token",
} as const;
