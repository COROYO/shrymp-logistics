import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/lib/auth/session";
import { BrandMark } from "@/app/_components/brand-mark";
import {
  Sidebar,
  type SidebarFooter,
  type SidebarSection,
} from "@/app/_components/sidebar";
import { MobileNav } from "@/app/_components/mobile-nav";

export default async function LagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/lager");
  if (user.role !== "LAGER" && user.role !== "ADMIN") {
    redirect("/login?error=no_role");
  }
  const isAdmin = user.role === "ADMIN";
  const t = await getTranslations("nav");

  const SECTIONS: SidebarSection[] = [
    {
      label: t("lager"),
      items: [
        { href: "/lager/picking", label: t("picking"), icon: "picking" },
      ],
    },
  ];

  const footer: SidebarFooter = {
    crossLink: isAdmin
      ? { href: "/admin", label: t("admin"), icon: "admin" }
      : undefined,
    userEmail: user.email,
  };

  return (
    <div className="flex min-h-screen w-full">
      <MobileNav
        sections={SECTIONS}
        footer={footer}
        variantLabel={t("lager")}
        homeHref="/lager"
      />
      <aside className="sticky top-0 hidden h-screen w-60 flex-col bg-brand-navy text-white shadow-[2px_0_0_0_var(--color-brand-burgundy)] md:flex print:hidden">
        <div className="px-5 py-5">
          <Link href="/lager" className="flex items-center">
            <BrandMark />
          </Link>
          <div className="mt-1 ml-12 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
            {t("lager")}
          </div>
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto">
          <Sidebar sections={SECTIONS} footer={footer} />
        </div>
      </aside>
      <main className="flex-1 min-w-0 px-6 py-8 md:px-10">{children}</main>
    </div>
  );
}
