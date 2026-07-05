"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { updateShopLagerSettings } from "@/server/tenant/shop";
import { loadLagerConfig } from "@/server/lager/config";

export type SaveCatalogSyncResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveCatalogSyncAction(
  formData: FormData,
): Promise<SaveCatalogSyncResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const shopId = await requireActiveShopId(user);
  const cfg = await loadLagerConfig(shopId);
  await updateShopLagerSettings(shopId, {
    batches_enabled: cfg.batches_enabled,
    batch_min_days_before_expiry: cfg.batch_min_days_before_expiry,
    catalog_sync_to_shopify: formData.get("catalog_sync_to_shopify") === "1",
    updated_by_uid: user.uid,
  });

  revalidatePath("/admin/settings/shopify");
  revalidatePath("/admin/products");
  return { ok: true };
}
