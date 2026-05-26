import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LogoutButton } from "@/app/_components/logout-button";

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
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/lager" className="text-sm font-semibold">
              Monolith Lager
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600">
              <Link href="/lager/picking" className="hover:text-zinc-900">
                Picking
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-500">{user.email}</span>
            {user.role === "ADMIN" ? (
              <Link
                href="/admin"
                className="text-zinc-500 hover:text-zinc-900"
              >
                ↗ Admin
              </Link>
            ) : null}
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
