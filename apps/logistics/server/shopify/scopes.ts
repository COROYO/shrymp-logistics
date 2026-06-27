/**
 * OAuth scopes requested on install / reconnect.
 * Keep in sync with the app configuration in the Shopify Partner Dashboard.
 */
export const REQUIRED_OAUTH_SCOPES = [
  "read_products",
  "read_orders",
  "write_orders",
  "read_customers",
  "read_inventory",
  "write_inventory",
  "read_fulfillments",
  "write_fulfillments",
  "read_locations",
] as const;

export const REQUIRED_OAUTH_SCOPE_STRING = REQUIRED_OAUTH_SCOPES.join(",");
