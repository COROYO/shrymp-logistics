"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import {
  SHOP_COOKIE,
  TenantError,
  listAccessibleShopIds,
} from "@/lib/auth/tenant";
import { normalizeShopId } from "@/server/tenant/id";

export async function selectShopAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const shopId = String(formData.get("shopId") ?? "");
  const next = String(formData.get("next") ?? "");
  const normalized = normalizeShopId(shopId);
  const accessible = await listAccessibleShopIds(user);
  if (!accessible.includes(normalized)) {
    throw new TenantError("FORBIDDEN", "Shop not accessible.");
  }

  const jar = await cookies();
  jar.set(SHOP_COOKIE, normalized, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  const target =
    next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  redirect(target);
}
