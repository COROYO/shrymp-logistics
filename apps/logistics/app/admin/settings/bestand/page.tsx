import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { PushInventoryButton } from "../push-inventory-button";

export const dynamic = "force-dynamic";

export default async function BestandSettingsPage() {
  await requireTenantPageContext("/admin/settings/bestand");

  return (
    <section className="card p-6">
      <p className="eyebrow">Bestand</p>
      <h2 className="mt-1 text-sm font-semibold text-brand-navy">
        Bestände nach Shopify pushen
      </h2>
      <p className="mt-1 text-xs text-brand-navy/60">
        Schreibt für jede Variante den aktuellen <code>available</code>-Wert
        (= <code>on_hand_total − reserved_total</code>) per{" "}
        <code>inventorySetOnHandQuantities</code> nach Shopify. Nötig nach dem
        ersten Wareneingang oder bei manuellem Drift.
      </p>
      <div className="mt-5">
        <PushInventoryButton />
      </div>
    </section>
  );
}
