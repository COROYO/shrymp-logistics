/**
 * External link helpers to the merchant's existing DHL label tools.
 *
 * Standard inland: EasyDHL Shopify-App embedded inside the merchant admin.
 * Express international: DHL Express Commerce stand-alone page.
 *
 * The numeric Shopify order id is appended; the shop domain is required to
 * route into the merchant's admin namespace.
 */

export type DhlLinks = {
  standard: string;
  express: string;
};

/** Extract the shop handle ("monolithcaviar") from a "monolithcaviar.myshopify.com". */
function shopHandleFromDomain(shopDomain: string): string {
  const m = shopDomain.match(/^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/i);
  return m?.[1] ?? shopDomain;
}

export function buildDhlLinks(
  orderId: string,
  shopDomain: string,
): DhlLinks {
  const id = encodeURIComponent(orderId);
  const shop = encodeURIComponent(shopDomain);
  const handle = shopHandleFromDomain(shopDomain);
  return {
    standard: `https://admin.shopify.com/store/${handle}/apps/easydhl/fulfillments/create?id=${id}&shop=${shop}`,
    express: `https://dhlexpresscommerce.com/templates/admin4/quickprint.aspx?id=${id}&shop=${shop}`,
  };
}
