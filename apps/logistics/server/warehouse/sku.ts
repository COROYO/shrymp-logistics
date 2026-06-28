import "server-only";
import { randomInt } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Variant } from "@/server/firestore/schema";
import { variantsForShop } from "@/server/tenant/queries";
import { normalizeShopId } from "@/server/tenant/id";
import { inventoryItemUpdateSku } from "@/server/shopify/mutations";
import { log } from "@/lib/logger";

export class SkuError extends Error {
  constructor(
    public readonly code:
      | "invalid_sku"
      | "duplicate_sku"
      | "not_found"
      | "no_inventory_item"
      | "generate_failed",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "SkuError";
  }
}

const MAX_SKU_LEN = 64;
// Unambiguous Crockford-ish charset (no 0/O/1/I/L) for generated SKUs.
const GEN_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GEN_LEN = 8;

export function normalizeSku(raw: string): string {
  return raw.trim();
}

/** True if `sku` is free in this shop (ignoring `exceptVariantId`). */
async function isSkuFree(
  shopId: string,
  sku: string,
  exceptVariantId?: string,
): Promise<boolean> {
  const db = adminDb();
  const snap = await variantsForShop(db, shopId)
    .where("sku", "==", sku)
    .limit(2)
    .get();
  return snap.docs.every((d) => d.id === exceptVariantId);
}

function randomSku(): string {
  let s = "";
  for (let i = 0; i < GEN_LEN; i++) {
    s += GEN_CHARSET[randomInt(GEN_CHARSET.length)];
  }
  // Group as XXXX-XXXX for readability on labels.
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Generate a random SKU that is unique within the shop. */
export async function generateUniqueSku(shopId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = randomSku();
    if (await isSkuFree(shopId, candidate)) return candidate;
  }
  throw new SkuError("generate_failed");
}

/**
 * Assign a SKU to a variant: enforce shop-uniqueness, push to Shopify (SKU
 * lives on the InventoryItem — the catalog source of truth), then mirror to
 * Firestore so the UI and scanner pick it up immediately. Shopify-first means
 * a failed push never leaves Firestore ahead of the source of truth.
 */
export async function assignVariantSku(
  shopId: string,
  variantId: string,
  rawSku: string,
  uid: string | null,
): Promise<{ sku: string }> {
  const sku = normalizeSku(rawSku);
  if (!sku || sku.length > MAX_SKU_LEN) throw new SkuError("invalid_sku");

  const db = adminDb();
  const normalizedShop = normalizeShopId(shopId);
  const ref = db.collection(Collections.Variants).doc(variantId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as Variant).shop_id !== normalizedShop) {
    throw new SkuError("not_found");
  }
  const variant = snap.data() as Variant;
  if (variant.sku === sku) return { sku };

  if (!(await isSkuFree(shopId, sku, variantId))) {
    throw new SkuError("duplicate_sku");
  }

  const inventoryItemGid = variant.inventory_item_gid;
  if (!inventoryItemGid) throw new SkuError("no_inventory_item");

  // Shopify first — source of truth. Throws ShopifyGraphQLError on failure.
  await inventoryItemUpdateSku(inventoryItemGid, sku, shopId);

  await ref.update({
    sku,
    updated_at: FieldValue.serverTimestamp(),
  });
  log.info("variant_sku_assigned", { shopId, variantId, sku, uid });
  return { sku };
}

/** Generate + assign a unique SKU in one step. */
export async function generateAndAssignSku(
  shopId: string,
  variantId: string,
  uid: string | null,
): Promise<{ sku: string }> {
  const sku = await generateUniqueSku(shopId);
  return assignVariantSku(shopId, variantId, sku, uid);
}
