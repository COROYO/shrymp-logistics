import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { normalizeShopId } from "@/server/tenant/id";
import { getShop, listActiveShops } from "@/server/tenant/shop";
import { loadUserShopIds } from "@/lib/auth/user-shops";
import { isSuperAdminEmail } from "@/lib/auth/super-admin";
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

async function listAccessibleShopIdsUncached(
  uid: string,
  role: SessionUser["role"],
  email: string | null,
): Promise<string[]> {
  if (role === "ADMIN" && isSuperAdminEmail(email)) {
    const shops = await listActiveShops();
    return shops.map((s) => s.id).sort((a, b) => a.localeCompare(b));
  }

  const restricted = await loadUserShopIds(uid);
  if (!restricted || restricted.length === 0) {
    if (role === "ADMIN") return [];
    throw new TenantError(
      "NO_SHOPS",
      "Kein Mandant zugewiesen — Admin muss shop_ids setzen.",
    );
  }

  const db = adminDb();
  const snaps = await db.getAll(
    ...restricted.map((id) =>
      db.collection(Collections.Shops).doc(normalizeShopId(id)),
    ),
  );

  const out: string[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    if (snap.data()?.status !== "ACTIVE") continue;
    out.push(snap.id);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

const listAccessibleShopIdsCached = cache(listAccessibleShopIdsUncached);

/** Shops the user may access (explicit shop_ids only — no cross-tenant leakage). */
export async function listAccessibleShopIds(
  user: SessionUser,
): Promise<string[]> {
  return listAccessibleShopIdsCached(user.uid, user.role, user.email);
}

export type AccessibleShopOption = {
  id: string;
  shop_domain: string;
};

/** Resolved shop labels for the tenant switcher UI. */
export async function listAccessibleShopOptions(
  user: SessionUser,
): Promise<AccessibleShopOption[]> {
  const ids = await listAccessibleShopIds(user);
  const shops = await Promise.all(ids.map((id) => getShop(id)));
  return shops
    .filter((s): s is NonNullable<typeof s> => s != null && s.status === "ACTIVE")
    .map((s) => ({ id: s.id, shop_domain: s.shop_domain }))
    .sort((a, b) => a.shop_domain.localeCompare(b.shop_domain));
}

async function getActiveShopIdUncached(
  uid: string,
  role: SessionUser["role"],
  email: string | null,
): Promise<string> {
  const accessible = await listAccessibleShopIdsCached(uid, role, email);
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

const getActiveShopIdCached = cache(getActiveShopIdUncached);

export async function getActiveShopId(user: SessionUser): Promise<string> {
  return getActiveShopIdCached(user.uid, user.role, user.email);
}

export async function requireActiveShopId(user: SessionUser): Promise<string> {
  return getActiveShopIdCached(user.uid, user.role, user.email);
}

/** Like requireActiveShopId but sends multi-tenant users to /select-shop. */
export async function resolveActiveShopIdOrRedirect(
  user: SessionUser,
): Promise<string> {
  try {
    return await requireActiveShopId(user);
  } catch (e) {
    if (
      e instanceof TenantError &&
      (e.code === "SHOP_SELECTION_REQUIRED" || e.code === "NO_SHOPS")
    ) {
      redirect("/select-shop");
    }
    throw e;
  }
}
