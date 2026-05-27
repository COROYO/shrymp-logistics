import Link from "next/link";

const TILES: {
  href: string;
  title: string;
  desc: string;
}[] = [
  {
    href: "/admin/orders",
    title: "Orders",
    desc: "SHIP / STOP / NEW Übersicht",
  },
  {
    href: "/admin/batches",
    title: "Bestand & Chargen",
    desc: "Wareneingang, MHD, FEFO-Liste",
  },
  {
    href: "/admin/products",
    title: "Produkte",
    desc: "Shopify-Sync verwalten",
  },
  {
    href: "/admin/users",
    title: "Benutzer",
    desc: "Lager + Admins verwalten",
  },
  {
    href: "/admin/settings",
    title: "Einstellungen",
    desc: "Shopify-Verbindung, Webhooks, Allocation",
  },
  {
    href: "/lager",
    title: "Lager",
    desc: "Picking & Packing-Ansicht öffnen",
  },
];

export default function AdminHome() {
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Übersicht</p>
        <h1 className="h-display mt-1 text-3xl">Monolith Caviar Backoffice</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
          Wareneingang, Bestände, Orders, Allocation-Runs. Wähle einen Bereich
          aus.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group card relative overflow-hidden p-6 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="absolute inset-x-0 top-0 h-1 bg-brand-burgundy opacity-0 transition group-hover:opacity-100" />
            <h2 className="text-base font-semibold text-brand-navy">
              {t.title}
            </h2>
            <p className="mt-2 text-xs text-brand-navy/60">{t.desc}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
              Öffnen →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
