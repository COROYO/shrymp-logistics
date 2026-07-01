import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/session";
import { listAccessibleShopOptions } from "@/lib/auth/tenant";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { BrandMark } from "@/app/_components/brand-mark";
import { selectShopAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SelectShopPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/select-shop");

  const [{ next }, shops, t] = await Promise.all([
    searchParams,
    listAccessibleShopOptions(user),
    getTranslations("tenant"),
  ]);

  const nextPath =
    next?.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  const superAdmin = isSuperAdmin(user);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link href="/admin" className="inline-flex">
            <BrandMark />
          </Link>
          <h1 className="h-display mt-6 text-2xl">{t("selectShopTitle")}</h1>
          <p className="mt-2 text-sm text-brand-navy/70">
            {superAdmin ? t("selectShopIntroSuper") : t("selectShopIntro")}
          </p>
        </div>

        {shops.length === 0 ? (
          <div className="card p-6 text-center text-sm text-brand-navy/70">
            {t("noShopsAvailable")}
          </div>
        ) : (
          <ul className="card divide-y divide-zinc-200 overflow-hidden">
            {shops.map((shop) => (
              <li key={shop.id}>
                <form action={selectShopAction}>
                  <input type="hidden" name="shopId" value={shop.id} />
                  <input type="hidden" name="next" value={nextPath} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between px-6 py-4 text-left text-sm font-semibold text-brand-navy transition hover:bg-zinc-50"
                  >
                    <span>{shop.shop_domain}</span>
                    <span className="text-brand-burgundy">→</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <p className="text-center text-xs text-brand-navy/50">
          {user.email}
          {superAdmin ? ` · ${t("superAdmin")}` : null}
        </p>
      </div>
    </div>
  );
}
