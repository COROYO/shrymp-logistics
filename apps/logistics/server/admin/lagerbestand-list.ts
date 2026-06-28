import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { type Location, type Product, type Variant } from "@/server/firestore/schema";
import {
  locationsForShop,
  productsForShop,
  variantsForShop,
} from "@/server/tenant/queries";
import { loadOrderDemandByVariant } from "@/server/inventory/reserved";
import { loadShippableQtyByVariant } from "@/server/inventory/shippable-stock";
import { loadLocationStockForVariants } from "@/server/locations/stock";
import type { LagerbestandRow } from "@/app/admin/lagerbestand/lagerbestand-table";

export async function loadLagerbestandRows(shopId: string): Promise<LagerbestandRow[]> {
  const db = adminDb();
  const [productsSnap, variantsSnap, reservedByVariant, locationsSnap, lagerCfg] =
    await Promise.all([
      productsForShop(db, shopId).get(),
      variantsForShop(db, shopId).get(),
      loadOrderDemandByVariant(shopId),
      locationsForShop(db, shopId).where("active", "==", true).get(),
      import("@/server/lager/config").then(({ loadLagerConfig }) =>
        loadLagerConfig(shopId),
      ),
    ]);

  const locationNameById: Record<string, string> = {};
  for (const doc of locationsSnap.docs) {
    const loc = doc.data() as Location;
    locationNameById[loc.id] = loc.name;
  }

  const variantIds = variantsSnap.docs.map((d) => d.id);
  const [shippableByVariant, stockByVariant] = await Promise.all([
    lagerCfg.batches_enabled
      ? loadShippableQtyByVariant(variantIds, shopId, lagerCfg)
      : Promise.resolve(null as Map<string, number> | null),
    loadLocationStockForVariants(variantIds),
  ]);

  const products = new Map<string, Product>();
  for (const p of productsSnap.docs) {
    products.set(p.id, p.data() as Product);
  }

  const rows: LagerbestandRow[] = [];
  for (const v of variantsSnap.docs) {
    const variant = v.data() as Variant;
    const product = products.get(variant.product_id);
    if (!product) continue;
    if (product.status === "ARCHIVED" || product.is_bundle === true) continue;

    const reserved = reservedByVariant.get(variant.id) ?? 0;
    const variantOnHand = lagerCfg.batches_enabled
      ? (shippableByVariant?.get(variant.id) ?? 0)
      : (variant.on_hand_total ?? 0);
    const locationRows = stockByVariant.get(variant.id) ?? [];

    if (locationRows.length === 0) {
      rows.push({
        productId: product.id,
        variantId: variant.id,
        productTitle: product.title,
        variantTitle: variant.title,
        sku: variant.sku ?? null,
        locationId: null,
        locationName: null,
        onHand: variantOnHand,
        reserved,
        difference: variantOnHand - reserved,
      });
      continue;
    }

    for (const loc of locationRows) {
      rows.push({
        productId: product.id,
        variantId: variant.id,
        productTitle: product.title,
        variantTitle: variant.title,
        sku: variant.sku ?? null,
        locationId: loc.locationId,
        locationName: locationNameById[loc.locationId] ?? loc.locationId,
        onHand: loc.onHand,
        reserved: 0,
        difference: loc.onHand,
      });
    }

    if (locationRows.length > 1) {
      rows.push({
        productId: product.id,
        variantId: variant.id,
        productTitle: product.title,
        variantTitle: variant.title,
        sku: variant.sku ?? null,
        locationId: null,
        locationName: "Σ Variante",
        onHand: variantOnHand,
        reserved,
        difference: variantOnHand - reserved,
      });
    } else if (locationRows.length === 1) {
      const only = rows[rows.length - 1]!;
      only.reserved = reserved;
      only.difference = only.onHand - reserved;
    }
  }

  rows.sort((a, b) => {
    const byProduct = a.productTitle.localeCompare(b.productTitle);
    if (byProduct !== 0) return byProduct;
    const byVariant = a.variantTitle.localeCompare(b.variantTitle);
    if (byVariant !== 0) return byVariant;
    return (a.locationName ?? "").localeCompare(b.locationName ?? "");
  });

  return rows;
}
