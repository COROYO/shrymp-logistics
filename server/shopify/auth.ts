/**
 * Shopify shop-domain validation.
 *
 * No OAuth — this app uses a pre-installed Custom App in the Shopify Admin.
 * Credentials come straight from ENV (see `client.ts` and `hmac.ts`).
 */

export function isValidShopDomain(shop: string | null | undefined): boolean {
  if (!shop) return false;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop.trim());
}
