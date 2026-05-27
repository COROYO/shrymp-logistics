import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LogoutButton } from "@/app/_components/logout-button";

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
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="text-sm font-semibold">
              Monolith Lager · Admin
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600">
              <Link href="/admin/orders" className="hover:text-zinc-900">
                Orders
              </Link>
              <Link href="/admin/batches" className="hover:text-zinc-900">
                Chargen
              </Link>
              <Link href="/admin/products" className="hover:text-zinc-900">
                Produkte
              </Link>
              <Link href="/admin/users" className="hover:text-zinc-900">
                Benutzer
              </Link>
              <Link href="/admin/settings" className="hover:text-zinc-900">
                Einstellungen
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        {children}
      </main>
    </div>
  );
}
