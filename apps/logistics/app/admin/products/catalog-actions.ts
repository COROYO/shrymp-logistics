"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  CatalogSaveError,
  loadProductEditorPayload,
  saveProductEditor,
} from "@/server/catalog/save-product";
import { log } from "@/lib/logger";

export type SaveProductActionResult =
  | { ok: true; productId: string; syncedToShopify: boolean }
  | { ok: false; error: string; code?: string };

function mapError(e: unknown): SaveProductActionResult {
  if (e instanceof CatalogSaveError) {
    return { ok: false, error: e.message, code: e.code };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/write_products|access scope|access denied/i.test(msg)) {
    return { ok: false, error: "missing_scope", code: "missing_scope" };
  }
  log.warn("product_editor_save_failed", { error: msg });
  return { ok: false, error: msg };
}

export async function saveProductAction(
  raw: unknown,
): Promise<SaveProductActionResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const shopId = await requireActiveShopId(user);
    const result = await saveProductEditor({ shopId, raw, userId: user.uid });
    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${result.productId}`);
    revalidatePath("/admin/lagerbestand");
    return { ok: true, ...result };
  } catch (e) {
    return mapError(e);
  }
}

export async function saveProductAndRedirectAction(raw: unknown): Promise<void> {
  const res = await saveProductAction(raw);
  if (!res.ok) throw new Error(res.error);
  redirect(`/admin/products/${res.productId}`);
}

export async function loadProductEditorAction(productId?: string) {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return null;
  }
  const shopId = await requireActiveShopId(user);
  try {
    return await loadProductEditorPayload(shopId, productId);
  } catch (e) {
    if (e instanceof CatalogSaveError && e.code === "not_found") return null;
    throw e;
  }
}
