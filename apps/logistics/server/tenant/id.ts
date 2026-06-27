import "server-only";

/** Normalize a Shopify shop domain to the Firestore tenant doc id. */
export function normalizeShopId(shopDomain: string): string {
  return shopDomain.trim().toLowerCase();
}

export function isValidShopId(shopId: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopId);
}

/** Accepts `my-store` or full `my-store.myshopify.com`. */
export function normalizeShopDomainInput(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  if (!isValidShopId(s)) return null;
  return s;
}
