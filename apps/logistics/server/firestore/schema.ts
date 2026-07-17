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

export const ProductMediaSchema = z.object({
  /** Shopify MediaImage GID when synced. */
  id: z.string().optional(),
  url: z.string().url(),
  alt: z.string().nullable().default(null),
  position: z.number().int().nonnegative(),
});

export const ProductMetafieldSchema = z.object({
  namespace: z.string().min(1),
  key: z.string().min(1),
  type: z.string().min(1),
  value: z.string(),
});

export const ProductOptionSchema = z.object({
  name: z.string().min(1),
  position: z.number().int(),
  values: z.array(z.string()),
});

export const ProductSchema = z.object({
  id: z.string(),
  /** Normalized myshopify.com domain — tenant scope. */
  shop_id: z.string(),
  shopify_gid: z.string(), // "gid://shopify/Product/123"
  title: z.string(),
  handle: z.string(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
  image_url: z.string().url().nullable().default(null),
  description_html: z.string().nullable().default(null),
  vendor: z.string().nullable().default(null),
  product_type: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  seo_title: z.string().nullable().default(null),
  seo_description: z.string().nullable().default(null),
  /** Shopify collection GIDs (numeric id or full gid). */
  collection_ids: z.array(z.string()).default([]),
  media: z.array(ProductMediaSchema).default([]),
  options: z.array(ProductOptionSchema).default([]),
  metafields: z.array(ProductMetafieldSchema).default([]),
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
  /** Shopify `ProductVariant.barcode` (EAN/UPC/GTIN). Used for scan matching. */
  barcode: z.string().nullable().default(null),
  title: z.string(),
  /** Variant-specific image, falls undefined fällt UI zurück auf product.image_url. */
  image_url: z.string().url().nullable().default(null),
  /** Verkaufspreis in der Default-Währung, als Smallest-Unit-Integer (z.B. 4990 für 49,90 EUR). */
  price_cents: z.number().int().nonnegative().nullable().default(null),
  compare_at_price_cents: z.number().int().nonnegative().nullable().default(null),
  /** Währungscode (z.B. EUR, USD), three-letter ISO. */
  currency: z.string().length(3).nullable().default(null),
  option1: z.string().nullable().default(null),
  option2: z.string().nullable().default(null),
  option3: z.string().nullable().default(null),
  position: z.number().int().nonnegative().default(0),
  on_hand_total: z.number().int().nonnegative().default(0),
  reserved_total: z.number().int().nonnegative().default(0),
  available: z.number().int().default(0),
  inventory_tracked: z.boolean().default(true),
  inventory_policy: z.enum(["DENY", "CONTINUE"]).default("DENY"),
  unit_cost_cents: z.number().int().nonnegative().nullable().default(null),
  updated_at: FirestoreTimestamp,
});

// ---------- locations (Shopify fulfillment / warehouse sites) ----------

export const LocationSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  shopify_gid: z.string(),
  name: z.string(),
  is_primary: z.boolean().default(false),
  fulfills_online_orders: z.boolean().default(true),
  /** False when removed/deactivated in Shopify. */
  active: z.boolean().default(true),
  synced_at: FirestoreTimestamp,
  updated_at: FirestoreTimestamp,
});

/** Per-variant physical stock at a single Shopify location. */
export const VariantLocationStockSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  variant_id: z.string(),
  location_id: z.string(),
  /** Physical units at this location (integer pieces). */
  on_hand: z.number().int().nonnegative().default(0),
  updated_at: FirestoreTimestamp,
});

// ---------- storage bins (intra-warehouse Lagerplätze) ----------
// Merchant-defined physical storage places inside the warehouse. Distinct from
// Shopify `Location` (a fulfillment site). The `code` is the scannable id and
// doubles as the printed "Lagernummer". Variant↔bin links live in a separate
// `variant_bins` collection so they survive Shopify catalog re-syncs.

export const StorageBinSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  /** Scannable, human-readable code, e.g. "A-01-02". Unique per shop (uppercased). */
  code: z.string().min(1).max(40),
  /** Display label, e.g. "Regal A · Fach 1". */
  name: z.string().min(1).max(80),
  /** Optional grouping (aisle/zone/room) for warehouse layout. */
  zone: z.string().max(40).nullable().default(null),
  note: z.string().max(200).nullable().default(null),
  active: z.boolean().default(true),
  /** Manual ordering for lists/labels. */
  sort_order: z.number().int().default(0),
  created_at: FirestoreTimestamp,
  updated_at: FirestoreTimestamp,
  created_by_uid: z.string().nullable().default(null),
});

/** Variant → primary storage bin link. Doc id = variant id. */
export const VariantBinSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  variant_id: z.string(),
  bin_id: z.string(),
  /** Denormalized for cheap picklist/label rendering without a bin join. */
  bin_code: z.string(),
  bin_name: z.string(),
  updated_at: FirestoreTimestamp,
  updated_by_uid: z.string().nullable().default(null),
});

// ---------- batches (Chargen) ----------

export const BatchStatusSchema = z.enum(["ACTIVE", "DEPLETED", "EXPIRED"]);

export const BatchSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  variant_id: z.string(),
  /** Firestore location doc id (Shopify location mirror). */
  location_id: z.string().optional(),
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

// ---------- pick runs (multi-order cluster picking with a cart) ----------
// A "Kommissionier-Lauf": one picker walks the warehouse once and fills
// several orders into separate cart slots (totes). Sorting happens during the
// pick (cluster picking), so packing afterwards is a clean per-order step.
//
// The run document is the single source of truth for pick progress — unlike
// the legacy single-order verifier this survives reloads and is multi-device
// safe. Each order maps to one slot; lines are aggregated per variant across
// all orders and carry the per-slot target + picked counts.

export const PickRunStatusSchema = z.enum([
  "PICKING", // staff is actively picking into the cart
  "PACKING", // all items picked — now packing order by order
  "DONE", // every order in the run is packed
  "CANCELLED", // aborted; orders returned to the SHIP queue
]);

/** One cart position (tote) = one order in the run. */
export const PickRunSlotSchema = z.object({
  /** 1-based tote position on the cart. */
  slot: z.number().int().positive(),
  order_id: z.string(),
  order_name: z.string(),
  express: z.boolean().default(false),
});

/** Per-order target + progress for a single aggregated pick line. */
export const PickRunLineSlotSchema = z.object({
  slot: z.number().int().positive(),
  order_id: z.string(),
  /** Units this order needs of the variant. */
  qty: z.number().int().positive(),
  /** Units already picked into this slot. */
  picked: z.number().int().nonnegative().default(0),
});

/**
 * One aggregated pick position: a variant collected once for the whole run,
 * then distributed across the slots that need it. Sorted by `bin_code` so the
 * picker walks an efficient path.
 */
export const PickRunLineSchema = z.object({
  variant_id: z.string(),
  title: z.string(),
  variant_title: z.string(),
  sku: z.string().nullable().default(null),
  barcode: z.string().nullable().default(null),
  bin_code: z.string().nullable().default(null),
  bin_name: z.string().nullable().default(null),
  total_qty: z.number().int().nonnegative(),
  slots: z.array(PickRunLineSlotSchema),
});

export const PickRunSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  status: PickRunStatusSchema.default("PICKING"),
  slots: z.array(PickRunSlotSchema),
  lines: z.array(PickRunLineSchema),
  /** Denormalized for cheap "is this order already in an active run" checks. */
  order_ids: z.array(z.string()).default([]),
  created_at: FirestoreTimestamp,
  created_by_uid: z.string(),
  updated_at: FirestoreTimestamp,
  completed_picking_at: FirestoreTimestamp.optional(),
  done_at: FirestoreTimestamp.optional(),
});

// ---------- product sync runs (background Shopify catalog pull) ----------

export const ProductSyncRunStatusSchema = z.enum([
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const ProductSyncRunPhaseSchema = z.enum([
  "starting",
  "locations",
  "catalog",
  "inventory",
  "applying_inventory",
  "done",
]);

export const ProductSyncRunSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  sync_inventory: z.boolean().default(false),
  status: ProductSyncRunStatusSchema.default("RUNNING"),
  phase: ProductSyncRunPhaseSchema.default("starting"),
  product_count: z.number().int().nonnegative().default(0),
  variant_count: z.number().int().nonnegative().default(0),
  inventory_updated: z.number().int().nonnegative().optional(),
  /** Set by admin to cooperatively stop between chunks. */
  cancel_requested: z.boolean().default(false),
  locations_synced: z.boolean().default(false),
  catalog_cursor: z.string().nullable().optional(),
  catalog_has_next: z.boolean().default(true),
  started_at: FirestoreTimestamp,
  updated_at: FirestoreTimestamp,
  finished_at: FirestoreTimestamp.optional(),
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

// ---------- test mode log (dry-run Shopify writes) ----------

export const TestModeLogSchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  mutation: z.string(),
  summary: z.string(),
  variables: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: FirestoreTimestamp,
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

/** Who owns sellable inventory: our warehouse app or Shopify Admin. */
export const InventorySourceSchema = z.enum(["APP", "SHOPIFY"]);

export const LagerConfigSchema = z.object({
  /** When false, skip Charge assignment, MHD checks, and batch-based stock caps. */
  batches_enabled: z.boolean().default(true),
  /**
   * APP: Firestore is source of truth; we push levels to Shopify and log
   * external changes as drift. SHOPIFY: inventory_levels/update webhooks
   * update our variant docs; we never push inventory to Shopify.
   */
  inventory_source: InventorySourceSchema.default("APP"),
  /**
   * Chargen mit MHD in ≤ N Kalendertagen (Europe/Berlin) werden bei der
   * Lieferschein-Zuordnung übersprungen. Bereits zugeordnete Chargen auf
   * Reprints bleiben unverändert.
   */
  batch_min_days_before_expiry: z.number().int().nonnegative().default(10),
  /**
   * When true (default), product edits in Admin are pushed back to Shopify.
   * Can be overridden per save in the product editor.
   */
  catalog_sync_to_shopify: z.boolean().default(true),
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
  /** DHL developer portal app credentials (client_id / client_secret). */
  api_key: z.string().nullable().default(null),
  api_secret: z.string().nullable().default(null),
  /** Geschäftskundenportal login for label creation. */
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
  refresh_token: z.string().optional(),
  access_token_expires_at: FirestoreTimestamp.optional(),
  refresh_token_expires_at: FirestoreTimestamp.optional(),
  installed_at: FirestoreTimestamp.optional(),
  location_gid: z.string().optional(),
  /** Default warehouse for inbound when UI does not pick a location. */
  default_location_id: z.string().optional(),
  api_version: z.string().default("2026-04"),
  batches_enabled: z.boolean().default(true),
  batch_min_days_before_expiry: z.number().int().nonnegative().default(10),
  inventory_source: InventorySourceSchema.default("APP"),
  catalog_sync_to_shopify: z.boolean().default(true),
  /**
   * When true (default), outbound Shopify mutations are skipped and logged
   * instead of executed — safe for merchant onboarding / demos.
   */
  test_mode: z.boolean().default(true),
  lager_updated_at: FirestoreTimestamp.optional(),
  lager_updated_by_uid: z.string().nullable().optional(),
  /** Per-shop DHL Parcel DE config (same shape as legacy config/dhl_config). */
  dhl_config: DhlConfigSchema.optional(),
  /** Per-shop packing slip (Lieferschein) branding. */
  slip_branding: SlipBrandingSchema.optional(),
  /** Firebase Auth uid of the merchant who connected this shop. */
  owner_uid: z.string().optional(),
  /** Last completed onboarding wizard step (0-based). */
  onboarding_step: z.number().int().nonnegative().optional(),
  /** Set when the merchant finishes the first-run setup wizard. */
  onboarding_completed_at: FirestoreTimestamp.optional(),
  created_at: FirestoreTimestamp,
  updated_at: FirestoreTimestamp,
});

// ---------- API keys (external REST access) ----------
// Doc id = SHA-256 hex of the raw key (never store plaintext).

export const ApiScopeSchema = z.enum([
  "orders:read",
  "inventory:read",
  "batches:read",
]);

export const ApiKeySchema = z.object({
  id: z.string(),
  shop_id: z.string(),
  label: z.string().min(1).max(80),
  scopes: z.array(ApiScopeSchema).min(1),
  created_at: FirestoreTimestamp,
  created_by_uid: z.string().nullable().default(null),
  last_used_at: FirestoreTimestamp.optional(),
  revoked_at: FirestoreTimestamp.optional(),
});

// ---------- forecasting ----------

export const ForecastMethodSchema = z.enum([
  "HOLT_WINTERS",
  "CROSTON",
  "MOVING_AVERAGE",
  "NONE",
]);

/**
 * Per-variant demand forecast, recomputed by the forecast job
 * (`server/forecasting/run.ts`).
 *
 * Forecast values are statistical *rates* (fractional units/day), not
 * inventory counts — the integer-quantities convention deliberately does
 * not apply here. UIs round up when presenting "units needed".
 * `history_total_units` can be fractional because legacy bundle-parent
 * sales are exploded into per-unit component quantities.
 */
export const ForecastSchema = z.object({
  id: z.string(), // `${shop_id}_${variant_id}`
  shop_id: z.string(),
  variant_id: z.string(),
  method: ForecastMethodSchema,
  horizon_days: z.number().int().positive(),
  /** Point forecast per future day, index 0 = tomorrow. */
  daily_forecast: z.array(z.number().nonnegative()),
  sigma_daily: z.number().nonnegative(),
  backtest_mae: z.number().nonnegative().nullable().default(null),
  avg_daily_units: z.number().nonnegative(),
  history_days: z.number().int().nonnegative(),
  nonzero_days: z.number().int().nonnegative(),
  history_total_units: z.number().nonnegative(),
  /** True if the series contains exploded legacy bundle-parent sales. */
  includes_exploded_bundles: z.boolean().default(false),
  generated_at: FirestoreTimestamp,
});

// ---------- exported types ----------

export type Product = z.infer<typeof ProductSchema>;
export type ProductMedia = z.infer<typeof ProductMediaSchema>;
export type ProductMetafield = z.infer<typeof ProductMetafieldSchema>;
export type ProductOption = z.infer<typeof ProductOptionSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type VariantLocationStock = z.infer<typeof VariantLocationStockSchema>;
export type StorageBin = z.infer<typeof StorageBinSchema>;
export type VariantBin = z.infer<typeof VariantBinSchema>;
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
export type PickRun = z.infer<typeof PickRunSchema>;
export type PickRunStatus = z.infer<typeof PickRunStatusSchema>;
export type PickRunSlot = z.infer<typeof PickRunSlotSchema>;
export type PickRunLine = z.infer<typeof PickRunLineSchema>;
export type PickRunLineSlot = z.infer<typeof PickRunLineSlotSchema>;
export type ProductSyncRun = z.infer<typeof ProductSyncRunSchema>;
export type ProductSyncRunStatus = z.infer<typeof ProductSyncRunStatusSchema>;
export type ProductSyncRunPhase = z.infer<typeof ProductSyncRunPhaseSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type ShopifyOutbox = z.infer<typeof ShopifyOutboxSchema>;
export type TestModeLog = z.infer<typeof TestModeLogSchema>;
export type Shop = z.infer<typeof ShopSchema>;
export type SlipBranding = z.infer<typeof SlipBrandingSchema>;
export type ShopStatus = z.infer<typeof ShopStatusSchema>;
export type ShopifyConfig = z.infer<typeof ShopifyConfigSchema>;
export type ShopifyToken = z.infer<typeof ShopifyTokenSchema>;
export type LagerConfig = z.infer<typeof LagerConfigSchema>;
export type InventorySource = z.infer<typeof InventorySourceSchema>;
export type DhlAddress = z.infer<typeof DhlAddressSchema>;
export type DhlConfig = z.infer<typeof DhlConfigSchema>;
export type OrderDhlShipment = z.infer<typeof OrderDhlShipmentSchema>;
export type ApiScope = z.infer<typeof ApiScopeSchema>;
export type ApiKey = z.infer<typeof ApiKeySchema>;
export type ForecastMethod = z.infer<typeof ForecastMethodSchema>;
export type Forecast = z.infer<typeof ForecastSchema>;

// ---------- collection name constants ----------

export const Collections = {
  Shops: "shops",
  Products: "products",
  Variants: "variants",
  Locations: "locations",
  VariantLocationStock: "variant_location_stock",
  StorageBins: "storage_bins",
  VariantBins: "variant_bins",
  Batches: "batches",
  Orders: "orders",
  Allocations: "allocations",
  InventoryMovements: "inventory_movements",
  Users: "users",
  AllocationRuns: "allocation_runs",
  PickRuns: "pick_runs",
  ProductSyncRuns: "product_sync_runs",
  WebhookEvents: "webhook_events",
  ShopifyOutbox: "shopify_outbox",
  TestModeLog: "test_mode_log",
  Config: "config",
  ApiKeys: "api_keys",
  Forecasts: "forecasts",
} as const;

export const ConfigDocs = {
  ShopifyMeta: "shopify_meta",
  ShopifyToken: "shopify_token",
  LagerConfig: "lager_config",
  DhlConfig: "dhl_config",
} as const;
