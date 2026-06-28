import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { BackfillOrdersButton } from "../backfill-orders-button";
import { RunAllocationButton } from "../run-allocation-button";

export const dynamic = "force-dynamic";

export default async function AuftraegeSettingsPage() {
  await requireTenantPageContext("/admin/settings/auftraege");

  return (
    <>
      <section className="card p-6">
        <p className="eyebrow">Aufträge</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Bestehende Aufträge importieren
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Holt alle offenen, noch nicht versendeten Bestellungen aus Shopify.
          Einmalig nach der Ersteinrichtung nötig — neue Bestellungen kommen
          danach automatisch.
        </p>
        <div className="mt-5">
          <BackfillOrdersButton />
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">Verfügbarkeit</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Aufträge neu prüfen
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Prüft, welche offenen Aufträge versandbereit sind und welche wegen
          fehlendem Bestand warten müssen. Läuft sonst automatisch im
          Hintergrund.
        </p>
        <div className="mt-5">
          <RunAllocationButton />
        </div>
      </section>
    </>
  );
}
