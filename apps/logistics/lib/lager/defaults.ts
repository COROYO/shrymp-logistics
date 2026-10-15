/** Default MHD cutoff when `config/lager_config` is not yet persisted. */
export const DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY = 10;

/** Charge tracking is on by default for new shops. */
export const DEFAULT_BATCHES_ENABLED = true;

/** App-owned inventory is the default — pushes to Shopify, ignores external drift. */
export const DEFAULT_INVENTORY_SOURCE = "APP" as const;

/** Product edits in Admin are pushed to Shopify by default. */
export const DEFAULT_CATALOG_SYNC_TO_SHOPIFY = true;

/** Status tags, fulfillment and inventory pushes are on until a shop turns them off. */
export const DEFAULT_SHOPIFY_WRITEBACK_TAGS = true;
export const DEFAULT_SHOPIFY_WRITEBACK_FULFILLMENT = true;
export const DEFAULT_SHOPIFY_WRITEBACK_INVENTORY = true;
/** Shopify emails the customer when we create the fulfillment. */
export const DEFAULT_SHOPIFY_FULFILLMENT_NOTIFY_CUSTOMER = true;

/** Tags written back to the Shopify order for each warehouse status. Empty = none. */
export const DEFAULT_SHOPIFY_TAG_SHIP = "LAGER_SHIP";
export const DEFAULT_SHOPIFY_TAG_STOP = "LAGER_STOP";
export const DEFAULT_SHOPIFY_TAG_PACKED = "LAGER_PACKED";

/** New shops start in test mode — no writes to Shopify until disabled. */
export const DEFAULT_TEST_MODE = true;

/**
 * Shopify order tags that get allocation Phase-A / pick-queue priority.
 * Merchants can override this list in Admin → Einstellungen → Aufträge.
 */
export const DEFAULT_PRIORITY_TAGS = ["EXPRESS_DHL"] as const;
