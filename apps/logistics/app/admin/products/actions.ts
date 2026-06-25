"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { syncProductsAndVariants } from "@/server/shopify/sync";
import { log } from "@/lib/logger";

export async function triggerProductSyncAction(): Promise<
  | { ok: true; productCount: number; variantCount: number; locationGid: string }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const user = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const result = await syncProductsAndVariants(shopId);
    revalidatePath("/admin/products");
    return { ok: true, ...result };
  } catch (e) {
    log.error("product_sync_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
