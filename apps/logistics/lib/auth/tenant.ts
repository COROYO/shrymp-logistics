import "server-only";
import { cookies } from "next/headers";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { listActiveShops, migrateLegacyShopIfNeeded } from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";
import type { SessionUser } from "./session";

export const SHOP_COOKIE = "__shop";

export class TenantError extends Error {
  constructor(
    public readonly code: "NO_SHOPS" | "SHOP_SELECTION_REQUIRED" | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TenantError";
  }
}

async function loadUserShopIds(uid: string): Promise<string[] | null> {
  const snap = await adminDb().collection(Collections.Users).doc(uid).get();
  const raw = snap.data()?.shop_ids;
  if (!Array.isArray(raw)) return null;
  return raw.map((s) => normalizeShopId(String(s)));
}

/** Shops the user may access (explicit shop_ids only — no cross-tenant leakage). */
export async function listAccessibleShopIds(
  user: SessionUser,
): Promise<string[]> {
  await migrateLegacyShopIfNeeded();
  const active = await listActiveShops();
  const activeIds = active.map((s) => s.id);

  const restricted = await loadUserShopIds(user.uid);
  if (!restricted || restricted.length === 0) {
    if (user.role === "ADMIN") return [];
    throw new TenantError(
      "NO_SHOPS",
      "Kein Mandant zugewiesen — Admin muss shop_ids setzen.",
    );
  }
  return activeIds.filter((id) => restricted.includes(id));
}

export async function getActiveShopId(user: SessionUser): Promise<string> {
  const accessible = await listAccessibleShopIds(user);
  if (accessible.length === 0) {
    throw new TenantError("NO_SHOPS", "Kein aktiver Shopify-Mandant.");
  }

  const jar = await cookies();
  const fromCookie = jar.get(SHOP_COOKIE)?.value;
  if (fromCookie) {
    const normalized = normalizeShopId(fromCookie);
    if (accessible.includes(normalized)) return normalized;
  }

  if (accessible.length === 1) return accessible[0]!;

  throw new TenantError(
    "SHOP_SELECTION_REQUIRED",
    "Bitte Mandant auswählen.",
  );
}

export async function requireActiveShopId(user: SessionUser): Promise<string> {
  return getActiveShopId(user);
}
