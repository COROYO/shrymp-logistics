"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import {
  applyLagerbestandImport,
  type ImportSummary,
} from "@/server/inventory/lagerbestand-csv";
import { log } from "@/lib/logger";

export type ImportActionState =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string };

export async function importLagerbestandAction(
  formData: FormData,
): Promise<ImportActionState> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Keine Datei ausgewählt." };
  }
  if (file.size > 5_000_000) {
    return { ok: false, error: "Datei zu groß (max. 5 MB)." };
  }

  try {
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const text = await file.text();
    const summary = await applyLagerbestandImport(text, user.uid, shopId);
    revalidatePath("/admin/lagerbestand");
    revalidatePath("/admin/products");
    return { ok: true, summary };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("lagerbestand_import_failed", { error: msg });
    return { ok: false, error: msg };
  }
}

// --------------------------- inline edits ---------------------------

export type AdjustStockResult =
  | { ok: true; onHand: number }
  | { ok: false; error: string };

/**
 * Set the absolute on-hand for a variant at one location. Blocked when Chargen
 * are enabled (then stock is governed by batches, not a single number).
 */
export async function adjustStockAction(payload: {
  variantId: string;
  locationId?: string | null;
  onHand: number;
}): Promise<AdjustStockResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const variantId = String(payload.variantId ?? "").trim();
  const onHand = Number(payload.onHand);
  if (!variantId) return { ok: false, error: "invalid" };
  if (!Number.isInteger(onHand) || onHand < 0) {
    return { ok: false, error: "invalid_qty" };
  }

  try {
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);

    const { adminDb } = await import("@/server/firestore/admin");
    const { Collections } = await import("@/server/firestore/schema");
    const { normalizeShopId } = await import("@/server/tenant/id");
    const vSnap = await adminDb()
      .collection(Collections.Variants)
      .doc(variantId)
      .get();
    if (!vSnap.exists) return { ok: false, error: "not_found" };
    if (
      normalizeShopId((vSnap.data()?.shop_id as string) ?? "") !==
      normalizeShopId(shopId)
    ) {
      return { ok: false, error: "forbidden" };
    }

    const { isBatchesEnabled } = await import("@/server/lager/config");
    if (await isBatchesEnabled(shopId)) {
      return { ok: false, error: "batches_enabled" };
    }

    let locationId = payload.locationId ? String(payload.locationId).trim() : "";
    if (!locationId) {
      const { getDefaultLocationId } = await import("@/server/locations/stock");
      locationId = (await getDefaultLocationId(shopId)) ?? "";
    }
    if (!locationId) return { ok: false, error: "no_location" };

    const { adjustVariantStock } = await import(
      "@/server/inventory/variant-inventory"
    );
    await adjustVariantStock({
      variantId,
      locationId,
      newOnHand: onHand,
      reason: "Lagerbestand inline edit",
      userId: user.uid,
    });
    revalidatePath("/admin/lagerbestand");
    revalidatePath("/admin/products");
    return { ok: true, onHand };
  } catch (e) {
    log.warn("lagerbestand_adjust_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export type UpdateProductTitleResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

export async function updateProductTitleAction(payload: {
  productId: string;
  title: string;
}): Promise<UpdateProductTitleResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const productId = String(payload.productId ?? "").trim();
  const title = String(payload.title ?? "").trim();
  if (!productId) return { ok: false, error: "invalid" };
  if (!title) return { ok: false, error: "empty_title" };

  try {
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const { updateProductTitle } = await import("@/server/catalog/edit-fields");
    const result = await updateProductTitle({ shopId, productId, title });
    revalidatePath("/admin/lagerbestand");
    revalidatePath("/admin/products");
    return { ok: true, title: result.title };
  } catch (e) {
    return { ok: false, error: mapCatalogError(e, "product_title") };
  }
}

export type UpdateVariantSkuResult =
  | { ok: true; sku: string | null }
  | { ok: false; error: string };

export async function updateVariantSkuAction(payload: {
  variantId: string;
  sku: string;
}): Promise<UpdateVariantSkuResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const variantId = String(payload.variantId ?? "").trim();
  if (!variantId) return { ok: false, error: "invalid" };

  try {
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const { updateVariantSku } = await import("@/server/catalog/edit-fields");
    const result = await updateVariantSku({
      shopId,
      variantId,
      sku: String(payload.sku ?? ""),
    });
    revalidatePath("/admin/lagerbestand");
    revalidatePath("/admin/products");
    return { ok: true, sku: result.sku };
  } catch (e) {
    return { ok: false, error: mapCatalogError(e, "variant_sku") };
  }
}

function mapCatalogError(e: unknown, scope: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  log.warn("lagerbestand_field_edit_failed", { scope, error: msg });
  if (/write_products|access scope|access denied/i.test(msg)) {
    return "missing_scope";
  }
  if (msg === "wrong_tenant") return "forbidden";
  if (msg === "not_found") return "not_found";
  if (msg === "empty_title") return "empty_title";
  return msg;
}
