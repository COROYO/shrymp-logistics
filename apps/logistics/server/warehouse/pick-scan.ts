import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Order,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import { loadBinsForVariants } from "./bins";

/**
 * One expected pick position for the scan verifier. Quantities are aggregated
 * per variant (Shopify can split a product across several line items). The
 * client matches a scan against `barcode` first, then `sku`.
 */
export type PickScanItem = {
  variantId: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  qty: number;
  binCode: string | null;
  binName: string | null;
};

export async function loadPickScanItems(
  order: Order,
  shopId: string,
): Promise<PickScanItem[]> {
  void shopId;
  const db = adminDb();
  const variantIds = [
    ...new Set(order.line_items.map((li) => li.variant_id).filter(Boolean)),
  ];
  if (variantIds.length === 0) return [];

  const [variantSnaps, bins] = await Promise.all([
    db.getAll(
      ...variantIds.map((id) => db.collection(Collections.Variants).doc(id)),
    ),
    loadBinsForVariants(variantIds),
  ]);

  const variantById = new Map<string, Variant>();
  for (const s of variantSnaps) if (s.exists) variantById.set(s.id, s.data() as Variant);

  const productIds = [
    ...new Set(
      [...variantById.values()].map((v) => v.product_id).filter(Boolean),
    ),
  ];
  const productById = new Map<string, Product>();
  if (productIds.length > 0) {
    const pSnaps = await db.getAll(
      ...productIds.map((id) => db.collection(Collections.Products).doc(id)),
    );
    for (const s of pSnaps) if (s.exists) productById.set(s.id, s.data() as Product);
  }

  const byVariant = new Map<string, PickScanItem>();
  for (const li of order.line_items) {
    const v = variantById.get(li.variant_id);
    const p = v ? productById.get(v.product_id) : undefined;
    const bin = bins.get(li.variant_id);
    const existing = byVariant.get(li.variant_id);
    if (existing) {
      existing.qty += li.qty;
      continue;
    }
    byVariant.set(li.variant_id, {
      variantId: li.variant_id,
      title: p?.title ?? li.title,
      variantTitle: v?.title ?? "",
      sku: li.sku ?? v?.sku ?? null,
      barcode: v?.barcode ?? null,
      qty: li.qty,
      binCode: bin?.code ?? null,
      binName: bin?.name ?? null,
    });
  }

  return [...byVariant.values()].sort((a, b) => {
    // Group by bin code so the picker walks the warehouse in order.
    const byBin = (a.binCode ?? "~").localeCompare(b.binCode ?? "~", "de");
    if (byBin !== 0) return byBin;
    return a.title.localeCompare(b.title, "de");
  });
}
