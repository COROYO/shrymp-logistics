import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Product, type Variant } from "@/server/firestore/schema";
import { normalizeShopId } from "@/server/tenant/id";
import { log } from "@/lib/logger";
import {
  inventoryItemUpdateSku,
  productUpdateTitle,
} from "@/server/shopify/mutations";

/**
 * Write-back of catalog fields that Shopify owns (product title, variant SKU).
 * Shopify stays the source of truth: we push the change first and only mirror
 * it into Firestore on success, so a failed Shopify write never leaves the two
 * out of sync. Tenant ownership is verified before any write.
 */
export class CatalogEditError extends Error {
  constructor(
    public readonly code: "not_found" | "wrong_tenant" | "invalid",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CatalogEditError";
  }
}

export async function updateProductTitle(input: {
  shopId: string;
  productId: string;
  title: string;
}): Promise<{ title: string }> {
  const title = input.title.trim();
  if (!title) throw new CatalogEditError("invalid", "empty_title");

  const db = adminDb();
  const ref = db.collection(Collections.Products).doc(input.productId);
  const snap = await ref.get();
  if (!snap.exists) throw new CatalogEditError("not_found");
  const product = snap.data() as Product;
  if (normalizeShopId(product.shop_id) !== normalizeShopId(input.shopId)) {
    throw new CatalogEditError("wrong_tenant");
  }

  if (product.title !== title) {
    await productUpdateTitle(product.shopify_gid, title, input.shopId);
    // Mirror locally for an immediate UI refresh; the products/update webhook
    // reconciles the authoritative Shopify timestamps right after.
    await ref.update({ title });
    log.info("product_title_updated", { productId: input.productId });
  }
  return { title };
}

export async function updateVariantSku(input: {
  shopId: string;
  variantId: string;
  sku: string;
}): Promise<{ sku: string | null }> {
  const sku = input.sku.trim() ? input.sku.trim() : null;

  const db = adminDb();
  const ref = db.collection(Collections.Variants).doc(input.variantId);
  const snap = await ref.get();
  if (!snap.exists) throw new CatalogEditError("not_found");
  const variant = snap.data() as Variant;
  if (normalizeShopId(variant.shop_id) !== normalizeShopId(input.shopId)) {
    throw new CatalogEditError("wrong_tenant");
  }

  if ((variant.sku ?? null) !== sku) {
    await inventoryItemUpdateSku(variant.inventory_item_gid, sku, input.shopId);
    await ref.update({ sku, updated_at: FieldValue.serverTimestamp() });
    log.info("variant_sku_updated", { variantId: input.variantId });
  }
  return { sku };
}
