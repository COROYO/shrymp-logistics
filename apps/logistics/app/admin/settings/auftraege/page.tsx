import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadLagerConfig } from "@/server/lager/config";
import { BackfillOrdersButton } from "../backfill-orders-button";
import { RunAllocationButton } from "../run-allocation-button";
import { PriorityTagsForm } from "../priority-tags-form";
import { DefItem } from "../_shared";

export const dynamic = "force-dynamic";

export default async function AuftraegeSettingsPage() {
  const { shopId } = await requireTenantPageContext(
    "/admin/settings/auftraege",
  );
  const lagerCfg = await loadLagerConfig(shopId);

  return (
    <>
      <section className="card p-6">
        <p className="eyebrow">Priorität</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Prioritäts-Tags
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Bestellungen mit einem dieser Shopify-Tags werden bei der
          Bestandszuweisung zuerst bedient — unabhängig vom Bestelldatum der
          übrigen Aufträge.
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="Aktiv">
            <span className="font-mono text-xs">
              {lagerCfg.priority_tags.length > 0
                ? lagerCfg.priority_tags.join(", ")
                : "— keine —"}
            </span>
          </DefItem>
        </dl>

        <div className="mt-6">
          <PriorityTagsForm
            current={{ priority_tags: lagerCfg.priority_tags }}
          />
        </div>
      </section>

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
