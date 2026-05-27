import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LogoutButton } from "@/app/_components/logout-button";
import { BrandMark } from "@/app/_components/brand-mark";

const NAV_ITEMS = [
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/batches", label: "Chargen" },
  { href: "/admin/products", label: "Produkte" },
  { href: "/admin/users", label: "Benutzer" },
  { href: "/admin/settings", label: "Einstellungen" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect("/lager");

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-brand-navy text-white shadow-[0_2px_0_0_var(--color-brand-burgundy)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/admin" className="flex items-center gap-3">
              <BrandMark />
              <span className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 sm:inline">
                Admin
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/70">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="transition hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/lager"
                className="text-brand-burgundy transition hover:text-white"
              >
                Lager →
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="hidden text-white/60 md:inline">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
