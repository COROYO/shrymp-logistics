import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LogoutButton } from "@/app/_components/logout-button";
import { BrandMark } from "@/app/_components/brand-mark";

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

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-brand-navy text-white shadow-[0_2px_0_0_var(--color-brand-burgundy)] print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/lager" className="flex items-center gap-3">
              <BrandMark />
              <span className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 sm:inline">
                Lager
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/70">
              <Link
                href="/lager/picking"
                className="transition hover:text-white"
              >
                Picking
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="hidden text-white/60 md:inline">{user.email}</span>
            {user.role === "ADMIN" ? (
              <Link
                href="/admin"
                className="font-semibold uppercase tracking-[0.12em] text-white/70 transition hover:text-white"
              >
                Admin →
              </Link>
            ) : null}
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
