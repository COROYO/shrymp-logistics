import Link from "next/link";

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Übersicht</h1>
      <p className="text-sm text-zinc-600">
        Wareneingang, Bestände, Orders, Allocation-Runs. Wähle einen Bereich
        in der Navigation.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/orders"
          className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
        >
          <h2 className="text-sm font-semibold">Orders</h2>
          <p className="mt-1 text-xs text-zinc-500">
            SHIP / STOP / NEW Übersicht
          </p>
        </Link>
        <Link
          href="/admin/batches"
          className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
        >
          <h2 className="text-sm font-semibold">Wareneingang</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Neue Charge mit MHD erfassen
          </p>
        </Link>
        <Link
          href="/admin/products"
          className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
        >
          <h2 className="text-sm font-semibold">Produkte</h2>
          <p className="mt-1 text-xs text-zinc-500">Shopify-Sync verwalten</p>
        </Link>
        <Link
          href="/admin/users"
          className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
        >
          <h2 className="text-sm font-semibold">Benutzer</h2>
          <p className="mt-1 text-xs text-zinc-500">Lager + Admins verwalten</p>
        </Link>
        <Link
          href="/admin/settings"
          className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
        >
          <h2 className="text-sm font-semibold">Einstellungen</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Shopify-Verbindung, Webhooks, Backfill, Allocation
          </p>
        </Link>
        <Link
          href="/lager"
          className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
        >
          <h2 className="text-sm font-semibold">Lager</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Picking &amp; Packing-Ansicht öffnen
          </p>
        </Link>
      </div>
    </div>
  );
}
