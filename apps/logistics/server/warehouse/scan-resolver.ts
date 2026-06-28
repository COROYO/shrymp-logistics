import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Order,
  type Product,
  type StorageBin,
  type Variant,
} from "@/server/firestore/schema";
import {
  ordersForShop,
  storageBinsForShop,
  variantsForShop,
} from "@/server/tenant/queries";
import {
  loadBinsForVariants,
  normalizeBinCode,
  listVariantIdsInBin,
} from "./bins";
import { loadShippableQtyByVariant } from "@/server/inventory/shippable-stock";
import { loadReservedByVariant } from "@/server/inventory/reserved";

export type ScanVariantInfo = {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  onHand: number;
  reserved: number;
  binCode: string | null;
  binName: string | null;
};

export type ScanResult =
  | { kind: "order"; orderId: string; name: string; status: string }
  | { kind: "bin"; binId: string; code: string; name: string; variants: ScanVariantInfo[] }
  | { kind: "variant"; variant: ScanVariantInfo }
  | { kind: "unknown"; code: string };

/** Strip a leading "#" and surrounding whitespace from an order name scan. */
function orderNameVariants(raw: string): string[] {
  const t = raw.trim();
  const noHash = t.replace(/^#/, "");
  return Array.from(new Set([t, `#${noHash}`, noHash])).filter(Boolean);
}

async function resolveOrder(
  shopId: string,
  raw: string,
): Promise<ScanResult | null> {
  const db = adminDb();
  // Numeric → maybe the Shopify order id (= doc id).
  const numeric = raw.replace(/^#/, "").trim();
  if (/^\d{5,}$/.test(numeric)) {
    const byId = await db.collection(Collections.Orders).doc(numeric).get();
    if (byId.exists) {
      const o = byId.data() as Order;
      if (o.shop_id === shopId) {
        return { kind: "order", orderId: o.id, name: o.name, status: o.internal_status };
      }
    }
  }
  for (const name of orderNameVariants(raw)) {
    const snap = await ordersForShop(db, shopId)
      .where("name", "==", name)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (doc) {
      const o = doc.data() as Order;
      return { kind: "order", orderId: o.id, name: o.name, status: o.internal_status };
    }
  }
  return null;
}

async function buildVariantInfo(
  variants: Variant[],
  shopId: string,
): Promise<ScanVariantInfo[]> {
  if (variants.length === 0) return [];
  const db = adminDb();
  const ids = variants.map((v) => v.id);

  const productIds = [...new Set(variants.map((v) => v.product_id).filter(Boolean))];
  const [productSnaps, shippable, reserved, bins] = await Promise.all([
    productIds.length
      ? db.getAll(...productIds.map((id) => db.collection(Collections.Products).doc(id)))
      : Promise.resolve([]),
    loadShippableQtyByVariant(ids, shopId),
    loadReservedByVariant(shopId),
    loadBinsForVariants(ids),
  ]);
  const productById = new Map<string, Product>();
  for (const s of productSnaps) if (s.exists) productById.set(s.id, s.data() as Product);

  return variants.map((v) => {
    const p = productById.get(v.product_id);
    const bin = bins.get(v.id);
    return {
      variantId: v.id,
      productId: v.product_id,
      productTitle: p?.title ?? "—",
      variantTitle: v.title,
      sku: v.sku ?? null,
      barcode: v.barcode ?? null,
      imageUrl: v.image_url ?? p?.image_url ?? null,
      onHand: shippable.get(v.id) ?? 0,
      reserved: reserved.get(v.id) ?? 0,
      binCode: bin?.code ?? null,
      binName: bin?.name ?? null,
    };
  });
}

async function resolveBin(
  shopId: string,
  raw: string,
): Promise<ScanResult | null> {
  const db = adminDb();
  const snap = await storageBinsForShop(db, shopId)
    .where("code", "==", normalizeBinCode(raw))
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc) return null;
  const bin = doc.data() as StorageBin;

  const variantIds = await listVariantIdsInBin(shopId, doc.id);
  let variants: Variant[] = [];
  if (variantIds.length > 0) {
    const snaps = await db.getAll(
      ...variantIds.map((id) => db.collection(Collections.Variants).doc(id)),
    );
    variants = snaps.filter((s) => s.exists).map((s) => s.data() as Variant);
  }
  return {
    kind: "bin",
    binId: doc.id,
    code: bin.code,
    name: bin.name,
    variants: await buildVariantInfo(variants, shopId),
  };
}

async function resolveVariant(
  shopId: string,
  raw: string,
): Promise<ScanResult | null> {
  const db = adminDb();
  const code = raw.trim();

  // Match barcode first (real EAN/UPC), then SKU.
  for (const field of ["barcode", "sku"] as const) {
    const snap = await variantsForShop(db, shopId)
      .where(field, "==", code)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (doc) {
      const [info] = await buildVariantInfo([doc.data() as Variant], shopId);
      if (info) return { kind: "variant", variant: info };
    }
  }
  return null;
}

/**
 * Resolve a scanned/typed code to an order, a storage bin, or a product
 * variant. Resolution order is bin → variant(barcode/sku) → order so a numeric
 * EAN doesn't get mistaken for an order number.
 */
export async function resolveScan(
  shopId: string,
  rawCode: string,
): Promise<ScanResult> {
  const code = rawCode.trim();
  if (!code) return { kind: "unknown", code };

  const bin = await resolveBin(shopId, code);
  if (bin) return bin;

  const variant = await resolveVariant(shopId, code);
  if (variant) return variant;

  const order = await resolveOrder(shopId, code);
  if (order) return order;

  return { kind: "unknown", code };
}
