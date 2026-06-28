import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadLagerConfig } from "@/server/lager/config";
import { PushInventoryButton } from "../push-inventory-button";
import { InventorySourceForm } from "../inventory-source-form";

export const dynamic = "force-dynamic";

export default async function BestandSettingsPage() {
  const { shopId } = await requireTenantPageContext("/admin/settings/bestand");
  const lagerCfg = await loadLagerConfig(shopId);
  const appIsSource = lagerCfg.inventory_source === "APP";

  return (
    <>
      <section className="card p-6">
        <p className="eyebrow">Bestand</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Bestandsführung
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Legt fest, welches System die verkaufbare Menge autoritativ führt.
          Reservierungen für offene Aufträge bleiben in beiden Modi in der
          Lager-App.
        </p>
        <div className="mt-5">
          <InventorySourceForm
            current={{ inventory_source: lagerCfg.inventory_source }}
          />
        </div>
      </section>

      {appIsSource ? (
        <section className="card p-6">
          <p className="eyebrow">Shopify-Sync</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            Bestände nach Shopify pushen
          </h2>
          <p className="mt-1 text-xs text-brand-navy/60">
            Schreibt für jede Variante den aktuellen{" "}
            <code>available</code>-Wert (={" "}
            <code>on_hand_total − reserved_total</code>) per{" "}
            <code>inventorySetOnHandQuantities</code> nach Shopify. Nötig nach
            dem ersten Wareneingang oder bei manuellem Drift.
          </p>
          <div className="mt-5">
            <PushInventoryButton />
          </div>
        </section>
      ) : (
        <section className="card p-6">
          <p className="eyebrow">Shopify-Sync</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            Push deaktiviert
          </h2>
          <p className="mt-1 text-xs text-brand-navy/60">
            Shopify ist führend — Bestandsänderungen kommen über den Webhook{" "}
            <code>inventory_levels/update</code>. Passe Mengen in Shopify Admin
            an; die Lager-App übernimmt sie automatisch.
          </p>
        </section>
      )}
    </>
  );
}
