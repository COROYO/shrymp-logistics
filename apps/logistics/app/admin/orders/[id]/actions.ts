"use server";

import { revalidatePath } from "next/cache";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";
import { refreshOrderFromShopify } from "@/server/shopify/sync-orders";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import { requireRole } from "@/lib/auth/session";
import { listAccessibleShopIds } from "@/lib/auth/tenant";
import { normalizeShopId } from "@/server/tenant/id";
import { log } from "@/lib/logger";

export async function refreshOrderAction(
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: "forbidden" | "not_found" | "missing" | "failed" }> {
  try {
    const user = await requireRole("ADMIN");
    const snap = await adminDb().collection(Collections.Orders).doc(orderId).get();
    if (!snap.exists) return { ok: false, error: "not_found" };
    const order = snap.data() as Order;
    const accessible = await listAccessibleShopIds(user);
    if (!order.shop_id || !accessible.includes(normalizeShopId(order.shop_id))) {
      return { ok: false, error: "forbidden" };
    }
    if (!order.shopify_gid) return { ok: false, error: "missing" };

    const refreshed = await refreshOrderFromShopify(order.shop_id, order.shopify_gid);
    if (!refreshed.found) return { ok: false, error: "missing" };

    await enqueueAllocationRun({
      shopId: order.shop_id,
      triggeredBy: "MANUAL",
    });
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    return { ok: true };
  } catch (e) {
    log.error("order_refresh_failed", {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: "failed" };
  }
}
