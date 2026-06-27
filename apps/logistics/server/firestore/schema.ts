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
  /** Normalized myshopify.com domain — tenant scope. */
  shop_id: z.string(),
  shopify_gid: z.string(), // "gid://shopify/Product/123"
  title: z.string(),
  handle: z.string(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
  image_url: z.string().url().nullable().default(null),
  /**
   * True if the product is a Shopify bundle parent
   * (`Product.hasVariantsThatRequiresComponents`). Bundle parents are virtual:
   * they don't carry their own physical stock — the inventory lives on the
   * component variants. They are excluded from the Chargen / inventory views.
   */
  is_bundle: z.boolean().default(false),
  updated_at_shopify: FirestoreTimestamp.optional(),
  synced_at: FirestoreTimestamp,
});

export const VariantSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  product_id: z.string(),
  shopify_gid: z.string(),
  inventory_item_gid: z.string(),
  sku: z.string().nullable().default(null),
  title: z.string(),
  /** Variant-specific image, falls undefined fällt UI zurück auf product.image_url. */
  image_url: z.string().url().nullable().default(null),
  /** Verkaufspreis in der Default-Währung, als Smallest-Unit-Integer (z.B. 4990 für 49,90 EUR). */
  price_cents: z.number().int().nonnegative().nullable().default(null),
  /** Währungscode (z.B. EUR, USD), three-letter ISO. */
  currency: z.string().length(3).nullable().default(null),
  on_hand_total: z.number().int().nonnegative().default(0),
  reserved_total: z.number().int().nonnegative().default(0),
  available: z.number().int().default(0),
  updated_at: FirestoreTimestamp,
});

// ---------- batches (Chargen) ----------

export const BatchStatusSchema = z.enum(["ACTIVE", "DEPLETED", "EXPIRED"]);

export const BatchSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  variant_id: z.string(),
  charge_number: z.string(),
  expiry_date: FirestoreTimestamp,
  /**
   * Produktionsdatum der Charge (optional). Wird beim Wareneingang
   * miterfasst und ist nur für Audit/Tracebility relevant — die FEFO-
   * Allokation richtet sich weiterhin nach `expiry_date`.
   */
  production_date: FirestoreTimestamp.optional(),
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
  "PICKING", // Mitarbeiter:in hat die Order in der Hand — Allocation darf nicht anfassen
  "PACKED",
  "CANCELLED",
]);

/**
 * If the line item is part of a Shopify Bundle, `bundle` references the parent
 * `LineItemGroup`. Multiple line items on the same order can share the same
 * `group_id` to indicate they are components of the same bundle parent.
 *
 * Standalone (non-bundle) line items leave `bundle` undefined.
 */
export const OrderLineItemBundleSchema = z.object({
  group_id: z.string(),
  product_id: z.string().nullable().default(null),
  variant_id: z.string().nullable().default(null),
  variant_sku: z.string().nullable().default(null),
  title: z.string(),
  quantity: z.number().int().positive(),
});

export const OrderLineItemSchema = z.object({
  id: z.string(), // shopify line item id
  variant_id: z.string(), // firestore variant doc id
  variant_gid: z.string(),
  qty: z.number().int().positive(),
  title: z.string(),
  sku: z.string().nullable().default(null),
  bundle: OrderLineItemBundleSchema.optional(),
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

/** Primary Shopify shipping line — drives COD / premium detection. */
export const OrderShippingMethodSchema = z.object({
  title: z.string(),
  code: z.string().nullable().default(null),
});

/**
 * Persisted DHL shipment metadata, written after a successful
 * Parcel DE Shipping API call. The label PDF itself lives in Firebase Storage
 * (Cloud Storage), `dhl-labels/{orderId}/{shipmentNo}.pdf`.
 *
 * `label_url` is a v4-signed URL with ~7d expiry, refreshed by the UI on demand.
 */
export const OrderDhlShipmentSchema = z.object({
  shipment_no: z.string(), // 14-digit DHL Sendungsnummer (also the tracking number)
  product: z.string(), // "V01PAK" etc.
  tracking_url: z.string().url(),
  label_storage_path: z.string(), // path inside the storage bucket
  label_url: z.string().url().optional(), // last-issued signed URL
  label_url_expires_at: FirestoreTimestamp.optional(),
  weight_g: z.number().int().positive(),
  created_at: FirestoreTimestamp,
  created_by_uid: z.string(),
  sandbox: z.boolean().default(false),
});

export const OrderSchema = z.object({
  id: z.string(), // doc id = numeric shopify order id as string
  shop_id: z.string(),
  shopify_gid: z.string(),
  name: z.string(), // "#1001"
  tags: z.array(z.string()).default([]),
  shipping_address: ShippingAddressSchema.nullable().default(null),
  /** First Shopify shipping line (Versandmethode). */
  shipping_method: OrderShippingMethodSchema.nullable().default(null),
  line_items: z.array(OrderLineItemSchema),
  shopify_financial_status: z.string().nullable().default(null),
  shopify_fulfillment_status: z.string().nullable().default(null),
  internal_status: OrderInternalStatusSchema.default("NEW"),
  stop_reason: z.string().optional(),
  allocation_run_id: z.string().optional(),
  /**
   * The LAGER_* tag state we have *confirmed pushed* to Shopify. LAGER tags
   * are owned by our system (never sourced from Shopify's mirror); this field
   * is the source of truth for "do the Shopify tags need updating". Advanced
   * only after the LAGER_TAGS_SET outbox op succeeds, so a failed push is
   * retried on the next run instead of being skipped. `null` = never pushed.
   */
  lager_tag_synced: z.enum(["SHIP", "STOP"]).nullable().default(null),
  dhl_shipment: OrderDhlShipmentSchema.optional(),
  /**
   * Outstanding amount in smallest currency unit (cents) — used as the
   * Cash-on-Delivery (Nachnahme) amount when the shipping method indicates COD.
   * Mirrors Shopify `totalOutstandingSet.amount`.
   */
  cod_amount_cents: z.number().int().nonnegative().nullable().default(null),
  /** ISO-4217 currency code, e.g. "EUR". Mirrors Shopify `currencyCode`. */
  currency: z.string().length(3).nullable().default(null),
  /**
   * Free-text customer note from Shopify checkout (`Order.note`). Shown in
   * the UI as an icon next to the order number with the note revealed on hover.
   */
  customer_note: z.string().nullable().default(null),
  /**
   * Shopify order "additional details" (`note_attributes` / custom
   * attributes): key/value pairs from checkout — gift messages, delivery
   * instructions, custom fields. Shown on the order detail page, NOT on the
   * packing slip.
   */
  note_attributes: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional(),
  /**
   * Customer reference from Shopify. `shopify_id` is the stable identity
   * (used for grouping in `/admin/customers`); when it's null, the UI
   * groups by email instead. We don't run a separate `customers/`
   * collection — customer info is denormalized onto each order.
   */
  customer: z
    .object({
      shopify_id: z.string().nullable().default(null),
      email: z.string().nullable().default(null),
      first_name: z.string().nullable().default(null),
      last_name: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  /** Order subtotal in cents (smallest unit) — used in customer history view. */
  total_price_cents: z.number().int().nonnegative().nullable().default(null),
  /** Set when Shopify cancels the order. Reason is Shopify's string code (`customer`, `fraud`, `inventory`, `declined`, `other`). */
  cancelled_at: FirestoreTimestamp.optional(),
  cancel_reason: z.string().nullable().default(null).optional(),
  /**
   * Lieferschein number assigned on the first packing-slip print. Format
   * `L{seq}/{YY}` (e.g. `L00042/26`). Persisted so reprints reuse the same
   * number — the slip is a legal commercial document, mustn't drift between
   * print attempts.
   */
  lieferschein_no: z.string().optional(),
  lieferschein_date: FirestoreTimestamp.optional(),
  /** Picking/packing audit — set as the order moves through the workflow. */
  picking_started_at: FirestoreTimestamp.optional(),
  picking_started_by_uid: z.string().optional(),
  packed_at: FirestoreTimestamp.optional(),
  /** Firebase uid of the packer, or `"shopify"` for externally-fulfilled orders. */
  packed_by_uid: z.string().optional(),
  /** True when the order was fulfilled on Shopify's side, not via our packing UI. */
  externally_fulfilled: z.boolean().optional(),
  created_at_shopify: FirestoreTimestamp,
  updated_at: FirestoreTimestamp,
});

// ---------- allocations ----------

export const AllocationSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  order_id: z.string(),
  line_item_id: z.string(),
  variant_id: z.string(),
  batch_id: z.string(),
  qty: z.number().int().positive(),
  run_id: z.string(),
  created_at: FirestoreTimestamp,
  consumed_at: FirestoreTimestamp.optional(),
  /** True when the allocation was released (not actually consumed) — e.g. after order cancellation. Audit trail. */
  released: z.boolean().optional(),
  release_reason: z.string().optional(),
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
  shop_id: z.string(),
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
  /** Shops this user may access. Merchants get entries after OAuth install. */
  shop_ids: z.array(z.string()).optional(),
  /** Pre-filled shop domain from registration, cleared after OAuth. */
  pending_shop_domain: z.string().optional(),
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

/**
 * Every way an allocation run can be triggered. Single source of truth —
 * the Cloud Tasks consumer endpoint, the enqueue helper and the run options
 * all derive from this so a new trigger can't be added in one place and
 * silently rejected (HTTP 400) at another.
 *
 *   - realtime: ORDER_CREATED/UPDATED/CANCELLED, INBOUND, PACKING_DONE
 *   - operator: MANUAL (admin button)
 *   - safety nets: RECONCILE (5-min sweep), TAIL_SWEEP (post-run leftover),
 *     CRON (2-min "run if NEW orders exist" tick)
 */
export const AllocationTriggerSchema = z.enum([
  "ORDER_CREATED",
  "ORDER_UPDATED",
  "ORDER_CANCELLED",
  "INBOUND",
  "PACKING_DONE",
  "MANUAL",
  "RECONCILE",
  "TAIL_SWEEP",
  "CRON",
]);

export const AllocationRunSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  triggered_by: AllocationTriggerSchema,
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
  shop_id: z.string().optional(),
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
  shop_id: z.string(),
  op: z.enum([
    "TAGS_ADD",
    "TAGS_REMOVE",
    "LAGER_TAGS_SET",
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

// ---------- shopify config (legacy singletons in config/) ----------
// Deprecated — new installs use `shops/{shopId}`. Kept for one-time migration.
// `config/shopify_meta` — fulfillment-location reference + api version
// `config/shopify_token` — OAuth-acquired offline access token

export const ShopifyConfigSchema = z.object({
  shop_domain: z.string(),
  location_gid: z.string().optional(),
  api_version: z.string().default("2026-04"),
  updated_at: FirestoreTimestamp,
});

export const ShopifyTokenSchema = z.object({
  shop_domain: z.string(),
  access_token: z.string(),
  scope: z.string(),
  installed_at: FirestoreTimestamp,
});

// ---------- warehouse / picking configuration ----------
// `config/lager_config` — batch-assignment rules editable from Admin UI.

export const LagerConfigSchema = z.object({
  /** When false, skip Charge assignment, MHD checks, and batch-based stock caps. */
  batches_enabled: z.boolean().default(true),
  /**
   * Chargen mit MHD in ≤ N Kalendertagen (Europe/Berlin) werden bei der
   * Lieferschein-Zuordnung übersprungen. Bereits zugeordnete Chargen auf
   * Reprints bleiben unverändert.
   */
  batch_min_days_before_expiry: z.number().int().nonnegative().default(10),
  updated_at: FirestoreTimestamp,
  updated_by_uid: z.string().nullable().default(null),
});

// ---------- DHL Parcel DE Shipping configuration ----------
// `config/dhl_config` — billing number, shipper address, defaults, business
// customer portal credentials. All values are managed via the Admin UI.

export const DhlAddressSchema = z.object({
  name1: z.string().min(1).max(50),
  name2: z.string().max(50).nullable().default(null),
  addressStreet: z.string().min(1).max(50),
  addressHouse: z.string().max(10).nullable().default(null),
  postalCode: z.string().min(3).max(10),
  city: z.string().min(1).max(40),
  /** ISO 3166-1 alpha-3 (e.g. "DEU"). */
  country: z.string().length(3),
  email: z.string().email().nullable().default(null),
  phone: z.string().max(20).nullable().default(null),
});

export const DhlConfigSchema = z.object({
  /** 14-character DHL Abrechnungsnummer / EKP, e.g. "33333333330102". */
  billing_number: z.string().min(14).max(14),
  /** Standard "STANDARD_GRUPPENPROFIL" unless DHL assigned a dedicated profile. */
  profile: z.string().default("STANDARD_GRUPPENPROFIL"),
  shipper: DhlAddressSchema,
  /** Default parcel weight in grams when no per-shipment value is provided. */
  default_weight_g: z.number().int().positive().default(1000),
  default_dimensions_mm: z
    .object({
      length: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  /** Geschäftskundenportal username + password for OAuth2 ROPC. */
  gkp_username: z.string().nullable().default(null),
  gkp_password: z.string().nullable().default(null),
  /**
   * Cash-on-Delivery account reference configured under
   * "Versenden → Einstellungen → Nachnahme" in the DHL Geschäftskundenportal.
   * If null, COD will not be offered.
   */
  cod_account_reference: z.string().max(35).nullable().default(null),
  /** Toggle sandbox vs. production (api-sandbox.dhl.com vs api-eu.dhl.com). */
  sandbox: z.boolean().default(true),
  updated_at: FirestoreTimestamp,
  updated_by_uid: z.string().nullable().default(null),
});

// ---------- packing slip branding (per shop) ----------

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Must be #RRGGBB hex color");

export const SlipBrandingSchema = z.object({
  brand_name: z.string().min(1).max(80),
  eyebrow: z.string().max(120),
  company_line: z.string().max(200),
  contact_email: z.string().email().max(120),
  accent_color: hexColor,
  header_color: hexColor,
  document_title: z.string().min(1).max(40),
  signature: z.string().max(500),
  footer_legal: z.string().max(400),
  updated_at: FirestoreTimestamp.optional(),
  updated_by_uid: z.string().nullable().optional(),
});

// ---------- shops (multi-tenant root) ----------
// Doc id = normalized shop domain, e.g. `return-my-shrimps.myshopify.com`.

export const ShopStatusSchema = z.enum(["ACTIVE", "UNINSTALLED"]);

export const ShopSchema = z.object({
  id: z.string(),
  shop_domain: z.string(),
  status: ShopStatusSchema.default("ACTIVE"),
  access_token: z.string().optional(),
  scope: z.string().optional(),
  installed_at: FirestoreTimestamp.optional(),
  location_gid: z.string().optional(),
  api_version: z.string().default("2026-04"),
  batches_enabled: z.boolean().default(true),
  batch_min_days_before_expiry: z.number().int().nonnegative().default(10),
  lager_updated_at: FirestoreTimestamp.optional(),
  lager_updated_by_uid: z.string().nullable().optional(),
  /** Per-shop DHL Parcel DE config (same shape as legacy config/dhl_config). */
  dhl_config: DhlConfigSchema.optional(),
  /** Per-shop packing slip (Lieferschein) branding. */
  slip_branding: SlipBrandingSchema.optional(),
  /** Firebase Auth uid of the merchant who connected this shop. */
  owner_uid: z.string().optional(),
  created_at: FirestoreTimestamp,
  updated_at: FirestoreTimestamp,
});

// ---------- exported types ----------

export type Product = z.infer<typeof ProductSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type Batch = z.infer<typeof BatchSchema>;
export type BatchStatus = z.infer<typeof BatchStatusSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type OrderInternalStatus = z.infer<typeof OrderInternalStatusSchema>;
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;
export type OrderLineItemBundle = z.infer<typeof OrderLineItemBundleSchema>;
export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;
export type OrderShippingMethod = z.infer<typeof OrderShippingMethodSchema>;
export type Allocation = z.infer<typeof AllocationSchema>;
export type InventoryMovement = z.infer<typeof InventoryMovementSchema>;
export type MovementType = z.infer<typeof MovementTypeSchema>;
export type User = z.infer<typeof UserSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type AllocationRun = z.infer<typeof AllocationRunSchema>;
export type AllocationRunStatus = z.infer<typeof AllocationRunStatusSchema>;
export type AllocationTrigger = z.infer<typeof AllocationTriggerSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type ShopifyOutbox = z.infer<typeof ShopifyOutboxSchema>;
export type Shop = z.infer<typeof ShopSchema>;
export type SlipBranding = z.infer<typeof SlipBrandingSchema>;
export type ShopStatus = z.infer<typeof ShopStatusSchema>;
export type ShopifyConfig = z.infer<typeof ShopifyConfigSchema>;
export type ShopifyToken = z.infer<typeof ShopifyTokenSchema>;
export type LagerConfig = z.infer<typeof LagerConfigSchema>;
export type DhlAddress = z.infer<typeof DhlAddressSchema>;
export type DhlConfig = z.infer<typeof DhlConfigSchema>;
export type OrderDhlShipment = z.infer<typeof OrderDhlShipmentSchema>;

// ---------- collection name constants ----------

export const Collections = {
  Shops: "shops",
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
  LagerConfig: "lager_config",
  DhlConfig: "dhl_config",
} as const;
