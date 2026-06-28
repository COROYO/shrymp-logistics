import "server-only";
import { cache } from "react";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { normalizeShopId } from "@/server/tenant/id";

/** Per-request cached user → shop_ids lookup (shared across tenant + merchant). */
export const loadUserShopIds = cache(async (uid: string): Promise<string[] | null> => {
  const snap = await adminDb().collection(Collections.Users).doc(uid).get();
  const raw = snap.data()?.shop_ids;
  if (!Array.isArray(raw)) return null;
  return raw.map((s) => normalizeShopId(String(s)));
});
