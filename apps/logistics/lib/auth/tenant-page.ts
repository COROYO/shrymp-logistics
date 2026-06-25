import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";

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
  const shopId = await requireActiveShopId(user);
  return { user, shopId };
}
