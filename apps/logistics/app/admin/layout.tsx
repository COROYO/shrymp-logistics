import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/session";
import { merchantNeedsShopifyConnect } from "@/lib/auth/merchant";
import { merchantNeedsOnboarding } from "@/server/onboarding/state";
import { BrandMark } from "@/app/_components/brand-mark";
import {
  Sidebar,
  type SidebarFooter,
  type SidebarSection,
} from "@/app/_components/sidebar";
import { MobileNav } from "@/app/_components/mobile-nav";
import { AdminJobsTray } from "@/app/admin/_components/admin-jobs-tray";
import { ShopSwitcher } from "@/app/_components/shop-switcher";
import { runWithTenantAsync } from "@/server/tenant/context";
import {
  listAccessibleShopOptions,
  resolveActiveShopIdOrRedirect,
} from "@/lib/auth/tenant";
import { isSuperAdmin } from "@/lib/auth/super-admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect("/lager");

  const [needsConnect, needsOnboarding, t, shopId, shopOptions] =
    await Promise.all([
      merchantNeedsShopifyConnect(user),
      merchantNeedsOnboarding(user),
      getTranslations("nav"),
      resolveActiveShopIdOrRedirect(user),
      listAccessibleShopOptions(user),
    ]);
  if (needsConnect) redirect("/onboarding");
  if (needsOnboarding) redirect("/onboarding/setup");

  const stockItems = [
    {
      href: "/admin/allocations",
      label: t("allocations"),
      icon: "allocations" as const,
    },
    {
      href: "/admin/products",
      label: t("products"),
      icon: "products" as const,
    },
    {
      href: "/admin/lagerbestand",
      label: t("lagerbestand"),
      icon: "batches" as const,
    },
    {
      href: "/admin/lagerplaetze",
      label: t("lagerplaetze"),
      icon: "bins" as const,
    },
  ];

  const SECTIONS: SidebarSection[] = [
    {
      label: t("stock"),
      items: stockItems,
    },
    {
      label: t("operations"),
      items: [
        { href: "/admin/orders", label: t("orders"), icon: "orders" },
        { href: "/admin/customers", label: t("customers"), icon: "customers" },
      ],
    },
    {
      label: t("system"),
      items: [
        { href: "/admin/users", label: t("users"), icon: "users" },
        { href: "/admin/settings", label: t("settings"), icon: "settings" },
      ],
    },
  ];

  const footer: SidebarFooter = {
    crossLink: { href: "/lager", label: t("lager"), icon: "lager" },
    userEmail: user.email,
  };
  const superAdmin = isSuperAdmin(user);

  return runWithTenantAsync(shopId, async () => (
    <div className="flex min-h-screen w-full">
      <MobileNav
        sections={SECTIONS}
        footer={footer}
        variantLabel={t("admin")}
        homeHref="/admin"
        shopSwitcher={
          <ShopSwitcher
            shops={shopOptions}
            currentShopId={shopId}
            showSuperBadge={superAdmin}
          />
        }
      />
      <aside className="sticky top-0 hidden h-screen w-60 flex-col bg-brand-navy text-white shadow-[2px_0_0_0_var(--color-brand-burgundy)] md:flex print:hidden">
        <div className="px-5 py-5">
          <Link href="/admin" className="flex items-center">
            <BrandMark />
          </Link>
          <div className="mt-1 ml-12 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
            {t("admin")}
          </div>
        </div>
        <ShopSwitcher
          shops={shopOptions}
          currentShopId={shopId}
          showSuperBadge={superAdmin}
        />
        <div className="flex flex-1 flex-col overflow-y-auto">
          <Sidebar sections={SECTIONS} footer={footer} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
        <AdminJobsTray />
      </div>
    </div>
  ));
}
