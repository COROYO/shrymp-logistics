import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { normalizeShopId } from "@/server/tenant/id";
import { loadUserShopIds } from "@/lib/auth/user-shops";
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
): Promise<string[]> {
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
  return listAccessibleShopIdsCached(user.uid, user.role);
}

async function getActiveShopIdUncached(
  uid: string,
  role: SessionUser["role"],
): Promise<string> {
  const accessible = await listAccessibleShopIdsCached(uid, role);
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
  return getActiveShopIdCached(user.uid, user.role);
}

export async function requireActiveShopId(user: SessionUser): Promise<string> {
  return getActiveShopIdCached(user.uid, user.role);
}
