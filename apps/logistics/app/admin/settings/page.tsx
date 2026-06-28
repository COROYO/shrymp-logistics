import Link from "next/link";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadLagerConfig } from "@/server/lager/config";
import { SETTINGS_NAV } from "./settings-nav-config";

export const dynamic = "force-dynamic";

export default async function SettingsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string }>;
}) {
  const { shopId } = await requireTenantPageContext("/admin/settings");
  const [lagerCfg, sp] = await Promise.all([
    loadLagerConfig(shopId),
    searchParams,
  ]);
  const justInstalled = sp.installed === "1";

  return (
    <>
      {justInstalled ? (
        <div className="space-y-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Shopify erfolgreich verbunden. Als Nächstes: Produkte syncen, Orders
            nachladen, optional DHL konfigurieren.
          </div>
          <ol className="list-decimal list-inside space-y-2 rounded-md border border-zinc-200 bg-white px-4 py-4 text-sm text-brand-navy">
            <li>
              <strong>Produkte syncen</strong> unter{" "}
              <a
                href="/admin/settings/shopify"
                className="text-brand-burgundy underline"
              >
                Shopify-Einstellungen
              </a>
            </li>
            <li>
              <strong>Offene Orders nachladen</strong> unter{" "}
              <Link
                href="/admin/settings/auftraege"
                className="text-brand-burgundy underline"
              >
                Aufträge & Allocation
              </Link>
            </li>
            <li>
              <strong>Verbindung prüfen</strong> unter{" "}
              <Link
                href="/admin/settings/shopify"
                className="text-brand-burgundy underline"
              >
                Shopify
              </Link>
            </li>
            <li>
              <strong>DHL konfigurieren</strong> (falls Versandlabels gewünscht)
              unter{" "}
              <Link
                href="/admin/settings/dhl"
                className="text-brand-burgundy underline"
              >
                DHL Versand
              </Link>
            </li>
          </ol>
        </div>
      ) : null}

      <section className="card p-6">
        <p className="eyebrow">Übersicht</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Konfiguration nach Bereich
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Wähle links einen Bereich oder springe direkt zu einer Einstellung.
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
              Bestandsführung
            </dt>
            <dd className="mt-1">
              <span className="chip chip-emerald">
                {lagerCfg.inventory_source === "APP" ? "Lager-App" : "Shopify"}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
              Chargen-Tracking
            </dt>
            <dd className="mt-1">
              <span
                className={
                  lagerCfg.batches_enabled ? "chip chip-emerald" : "chip chip-amber"
                }
              >
                {lagerCfg.batches_enabled ? "Aktiv" : "Deaktiviert"}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
              MHD-Sperre
            </dt>
            <dd className="mt-1 font-mono text-xs">
              {lagerCfg.batches_enabled
                ? `${lagerCfg.batch_min_days_before_expiry} Tage`
                : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {SETTINGS_NAV.map((group) => (
        <section key={group.label} className="card p-6">
          <p className="eyebrow">{group.label}</p>
          <ul className="mt-3 divide-y divide-zinc-100">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between py-3 text-sm font-semibold text-brand-navy transition hover:text-brand-burgundy"
                >
                  <span>{item.label}</span>
                  <span className="text-brand-navy/30">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
