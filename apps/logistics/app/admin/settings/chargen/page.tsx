import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadLagerConfig } from "@/server/lager/config";
import { LagerConfigForm } from "../lager-config-form";
import { DefItem } from "../_shared";

export const dynamic = "force-dynamic";

export default async function ChargenSettingsPage() {
  const { shopId } = await requireTenantPageContext("/admin/settings/chargen");
  const lagerCfg = await loadLagerConfig(shopId);

  return (
    <section className="card p-6">
      <p className="eyebrow">Lager</p>
      <h2 className="mt-1 text-sm font-semibold text-brand-navy">
        Chargen & MHD
      </h2>
      <p className="mt-1 text-xs text-brand-navy/60">
        Steuert, ob Chargen beim Lieferschein-Druck zugeordnet werden und wie
        die MHD-Sperre greift. Bei deaktiviertem Chargen-Tracking läuft
        Allocation rein über Varianten-Bestand — ohne Chargen-Reads oder
        Charge-Freigaben.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
        <DefItem label="Chargen-Tracking">
          <span
            className={
              lagerCfg.batches_enabled ? "chip chip-emerald" : "chip chip-amber"
            }
          >
            {lagerCfg.batches_enabled ? "Aktiv" : "Deaktiviert"}
          </span>
        </DefItem>
        <DefItem label="Mindest-Restlaufzeit">
          <span className="font-mono text-xs">
            {lagerCfg.batches_enabled
              ? `${lagerCfg.batch_min_days_before_expiry} Tage`
              : "—"}
          </span>
        </DefItem>
      </dl>

      <div className="mt-6">
        <LagerConfigForm
          current={{
            batches_enabled: lagerCfg.batches_enabled,
            batch_min_days_before_expiry:
              lagerCfg.batch_min_days_before_expiry,
          }}
        />
      </div>
    </section>
  );
}
