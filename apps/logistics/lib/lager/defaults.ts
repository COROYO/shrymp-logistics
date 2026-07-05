/** Default MHD cutoff when `config/lager_config` is not yet persisted. */
export const DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY = 10;

/** Charge tracking is on by default for new shops. */
export const DEFAULT_BATCHES_ENABLED = true;

/** App-owned inventory is the default — pushes to Shopify, ignores external drift. */
export const DEFAULT_INVENTORY_SOURCE = "APP" as const;

/** Product edits in Admin are pushed to Shopify by default. */
export const DEFAULT_CATALOG_SYNC_TO_SHOPIFY = true;
