import "server-only";
import type { ProductEditorInput } from "@/server/catalog/editor-types";
import { fetchShopifyProductDetail } from "@/server/shopify/catalog-queries";
import { prepareCatalogInputForShopify } from "./shopify-catalog-normalize";
import { prepareEditorInputForShopifyPush } from "./reconcile-shopify-push";

/** Align editor variants with live Shopify before productSet (creates new, updates existing). */
export async function reconcileEditorInputWithShopify(
  input: ProductEditorInput,
  productGid: string,
  shopId: string,
): Promise<ProductEditorInput> {
  const remote = await fetchShopifyProductDetail(productGid, shopId);
  if (!remote) return prepareCatalogInputForShopify(input);
  return prepareEditorInputForShopifyPush(input, remote);
}
