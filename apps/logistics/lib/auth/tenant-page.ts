import "server-only";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { listAccessibleShopIds, resolveActiveShopIdOrRedirect } from "@/lib/auth/tenant";
import { normalizeShopId } from "@/server/tenant/id";

export type TenantPageContext = {
  user: SessionUser;
  shopId: string;
};

/** Auth + active shop for tenant-scoped server pages and actions. */
export async function requireTenantPageContext(
  nextPath: string,
): Promise<TenantPageContext> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const shopId = await resolveActiveShopIdOrRedirect(user);
  return { user, shopId };
}

/**
 * Tenant gate for detail pages resolved by raw document id (order, slip,
 * print, packing). Redirects to login when unauthenticated and 404s when the
 * document belongs to a shop the user can't access — masking cross-tenant ids.
 */
export async function assertShopAccessibleForPage(
  shopId: string | null | undefined,
  nextPath: string,
): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const accessible = await listAccessibleShopIds(user);
  if (!shopId || !accessible.includes(normalizeShopId(shopId))) {
    notFound();
  }
}
