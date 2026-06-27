import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { BackfillOrdersButton } from "../backfill-orders-button";
import { RunAllocationButton } from "../run-allocation-button";
import { Badge, DefItem, getEnvHealth } from "../_shared";

export const dynamic = "force-dynamic";

export default async function AuftraegeSettingsPage() {
  await requireTenantPageContext("/admin/settings/auftraege");
  const env = getEnvHealth();

  return (
    <>
      <section className="card p-6">
        <p className="eyebrow">Orders</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Orders nachladen (Backfill)
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Pullt alle <em>offenen, unfulfilled</em> Orders aus Shopify in unsere
          Datenbank. Nötig nach dem ersten App-Install.
        </p>
        <div className="mt-5">
          <BackfillOrdersButton />
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">Allocation</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Allocation-Run starten
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="Queue konfiguriert">
            <Badge ok={env.allocationQueue} />
          </DefItem>
          <DefItem label="Target URL">
            <span className="font-mono text-xs text-brand-navy/80">
              {env.allocationTargetUrl ?? "—"}
            </span>
          </DefItem>
        </dl>
        <div className="mt-5">
          <RunAllocationButton />
        </div>
      </section>
    </>
  );
}
