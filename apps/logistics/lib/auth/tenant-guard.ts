import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Batch, type Order, type Variant } from "@/server/firestore/schema";
import { normalizeShopId } from "@/server/tenant/id";
import { listAccessibleShopIds } from "@/lib/auth/tenant";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Cross-tenant access guard.
 *
 * The role check (`requireRole`) only proves *what* a user may do, never *to
 * which tenant's data*. Any operation that resolves a document by raw id
 * (orderId, variantId, batchId from the client) must additionally prove the
 * document belongs to a shop the user can access — otherwise a valid session
 * can reach across tenants (IDOR). These helpers are that second check.
 */

export class TenantAccessError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TenantAccessError";
  }
}

function assertShopAccessible(shopId: unknown, accessible: string[]): void {
  const normalized =
    typeof shopId === "string" ? normalizeShopId(shopId) : "";
  if (!normalized || !accessible.includes(normalized)) {
    // Mask existence: same error whether the doc is missing or foreign.
    throw new TenantAccessError("NOT_FOUND", "Resource not accessible.");
  }
}

/** Load an order and assert it belongs to a shop the user can access. */
export async function assertOrderAccessible(
  orderId: string,
  user: SessionUser,
): Promise<Order> {
  const accessible = await listAccessibleShopIds(user);
  const snap = await adminDb().collection(Collections.Orders).doc(orderId).get();
  if (!snap.exists) {
    throw new TenantAccessError("NOT_FOUND", "Order not found.");
  }
  const order = snap.data() as Order;
  assertShopAccessible(order.shop_id, accessible);
  return order;
}

/** Load a variant and assert tenant access. */
export async function assertVariantAccessible(
  variantId: string,
  user: SessionUser,
): Promise<Variant> {
  const accessible = await listAccessibleShopIds(user);
  const snap = await adminDb()
    .collection(Collections.Variants)
    .doc(variantId)
    .get();
  if (!snap.exists) {
    throw new TenantAccessError("NOT_FOUND", "Variant not found.");
  }
  const variant = snap.data() as Variant;
  assertShopAccessible(variant.shop_id, accessible);
  return variant;
}

/** Load a batch and assert tenant access. */
export async function assertBatchAccessible(
  batchId: string,
  user: SessionUser,
): Promise<Batch> {
  const accessible = await listAccessibleShopIds(user);
  const snap = await adminDb().collection(Collections.Batches).doc(batchId).get();
  if (!snap.exists) {
    throw new TenantAccessError("NOT_FOUND", "Batch not found.");
  }
  const batch = snap.data() as Batch;
  assertShopAccessible(batch.shop_id, accessible);
  return batch;
}

/** Assert a target user shares at least one shop with the acting admin. */
export async function assertUserInAccessibleShops(
  targetUid: string,
  actingUser: SessionUser,
): Promise<void> {
  const accessible = await listAccessibleShopIds(actingUser);
  const snap = await adminDb()
    .collection(Collections.Users)
    .doc(targetUid)
    .get();
  if (!snap.exists) {
    throw new TenantAccessError("NOT_FOUND", "User not found.");
  }
  const raw = snap.data()?.shop_ids;
  const targetShops = Array.isArray(raw)
    ? raw.map((s) => normalizeShopId(String(s)))
    : [];
  const overlap = targetShops.some((id) => accessible.includes(id));
  if (!overlap) {
    throw new TenantAccessError("FORBIDDEN", "User not in your tenant.");
  }
}
