import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { type Product, type Variant } from "@/server/firestore/schema";
import { productsForShop, variantsForShop } from "@/server/tenant/queries";

export type VariantLabel = {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number | null;
  currency: string | null;
};

/**
 * Variant rows for the product label sheet. Excludes archived products and
 * bundle parents (they carry no physical stock to label). Optionally narrowed
 * to one product or a single variant via `filter`.
 */
export async function loadVariantLabels(
  shopId: string,
  filter?: { productId?: string; variantId?: string },
): Promise<VariantLabel[]> {
  const db = adminDb();
  const [productsSnap, variantsSnap] = await Promise.all([
    productsForShop(db, shopId).get(),
    variantsForShop(db, shopId).get(),
  ]);

  const products = new Map<string, Product>();
  for (const p of productsSnap.docs) products.set(p.id, p.data() as Product);

  const out: VariantLabel[] = [];
  for (const v of variantsSnap.docs) {
    const variant = v.data() as Variant;
    if (filter?.variantId && variant.id !== filter.variantId) continue;
    if (filter?.productId && variant.product_id !== filter.productId) continue;
    const product = products.get(variant.product_id);
    if (!product) continue;
    if (product.status === "ARCHIVED" || product.is_bundle === true) continue;

    out.push({
      variantId: variant.id,
      productId: variant.product_id,
      productTitle: product.title,
      variantTitle: variant.title,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
      priceCents: variant.price_cents ?? null,
      currency: variant.currency ?? null,
    });
  }

  out.sort(
    (a, b) =>
      a.productTitle.localeCompare(b.productTitle, "de") ||
      a.variantTitle.localeCompare(b.variantTitle, "de"),
  );
  return out;
}
