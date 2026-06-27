import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { getShop } from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";
import type { SessionUser } from "./session";

async function loadUserShopIds(uid: string): Promise<string[]> {
  const snap = await adminDb().collection(Collections.Users).doc(uid).get();
  const raw = snap.data()?.shop_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => normalizeShopId(String(s)));
}

export async function loadPendingShopDomain(
  uid: string,
): Promise<string | null> {
  const snap = await adminDb().collection(Collections.Users).doc(uid).get();
  const raw = snap.data()?.pending_shop_domain;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeShopId(raw);
}

/** True when an ADMIN has no shop with a valid OAuth token yet. */
export async function merchantNeedsShopifyConnect(
  user: SessionUser,
): Promise<boolean> {
  if (user.role !== "ADMIN") return false;
  const shopIds = await loadUserShopIds(user.uid);
  if (shopIds.length === 0) return true;
  for (const id of shopIds) {
    const shop = await getShop(id);
    if (shop?.status === "ACTIVE" && shop.access_token) return false;
  }
  return true;
}

export class ShopLinkError extends Error {
  constructor(
    public readonly code: "shop_already_owned",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ShopLinkError";
  }
}

/** Refuse OAuth link when another merchant already owns this shop. */
export async function assertShopLinkable(
  uid: string,
  shopId: string,
): Promise<void> {
  const shop = await getShop(normalizeShopId(shopId));
  if (shop?.owner_uid && shop.owner_uid !== uid) {
    throw new ShopLinkError(
      "shop_already_owned",
      "Dieser Shopify-Shop ist bereits mit einem anderen Konto verbunden.",
    );
  }
}

export async function linkUserToShop(
  uid: string,
  shopId: string,
): Promise<void> {
  const normalized = normalizeShopId(shopId);
  await adminDb()
    .collection(Collections.Users)
    .doc(uid)
    .set(
      {
        shop_ids: FieldValue.arrayUnion(normalized),
        pending_shop_domain: FieldValue.delete(),
      },
      { merge: true },
    );
  await adminDb()
    .collection(Collections.Shops)
    .doc(normalized)
    .set({ owner_uid: uid }, { merge: true });
}
