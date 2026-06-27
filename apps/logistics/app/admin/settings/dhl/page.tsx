import { type DhlConfig } from "@/server/firestore/schema";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadDhlConfig } from "@/server/dhl/config";
import { DhlConfigForm, type DhlConfigFormValue } from "../dhl-config-form";
import { Badge, DefItem, getEnvHealth } from "../_shared";

export const dynamic = "force-dynamic";

function toClientDhlConfig(c: DhlConfig | null): DhlConfigFormValue | null {
  if (!c) return null;
  return {
    billing_number: c.billing_number,
    profile: c.profile,
    shipper: {
      name1: c.shipper.name1,
      name2: c.shipper.name2 ?? null,
      addressStreet: c.shipper.addressStreet,
      addressHouse: c.shipper.addressHouse ?? null,
      postalCode: c.shipper.postalCode,
      city: c.shipper.city,
      country: c.shipper.country,
      email: c.shipper.email ?? null,
      phone: c.shipper.phone ?? null,
    },
    default_weight_g: c.default_weight_g,
    default_dimensions_mm: c.default_dimensions_mm,
    gkp_username: c.gkp_username ?? null,
    gkp_password_set: !!c.gkp_password,
    cod_account_reference: c.cod_account_reference ?? null,
    sandbox: c.sandbox,
  };
}

export default async function DhlSettingsPage() {
  const { shopId } = await requireTenantPageContext("/admin/settings/dhl");
  const [dhlCfg, env] = await Promise.all([
    loadDhlConfig(shopId),
    Promise.resolve(getEnvHealth()),
  ]);

  return (
    <section className="card p-6">
      <p className="eyebrow">DHL Versand</p>
      <h2 className="mt-1 text-sm font-semibold text-brand-navy">
        DHL Parcel DE Shipping API
      </h2>
      <p className="mt-1 text-xs text-brand-navy/60">
        Erzeugt Versandetiketten direkt aus dem Packing-Screen. Inland (DE)
        geht über die DHL Parcel DE Shipping API v2.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
        <DefItem label="DHL_API_KEY (env)">
          <Badge ok={env.dhlApiKey} />
        </DefItem>
        <DefItem label="DHL_API_SECRET (env)">
          <Badge ok={env.dhlApiSecret} />
        </DefItem>
        <DefItem label="Abrechnungsnummer">
          <span className="font-mono text-xs">
            {dhlCfg?.billing_number ?? "—"}
          </span>
        </DefItem>
        <DefItem label="Endpunkt">
          <span className="font-mono text-xs">
            {dhlCfg ? (dhlCfg.sandbox ? "Sandbox" : "Production") : "—"}
          </span>
        </DefItem>
        <DefItem label="Absender">
          <span className="text-xs">
            {dhlCfg
              ? `${dhlCfg.shipper.name1}, ${dhlCfg.shipper.postalCode} ${dhlCfg.shipper.city}`
              : "—"}
          </span>
        </DefItem>
        <DefItem label="GKP-Credentials">
          <Badge ok={!!(dhlCfg?.gkp_username && dhlCfg?.gkp_password)} />
        </DefItem>
        <DefItem label="Nachnahme-Kontoreferenz">
          <span className="font-mono text-xs">
            {dhlCfg?.cod_account_reference ?? "—"}
          </span>
        </DefItem>
      </dl>
      <div className="mt-6">
        <DhlConfigForm current={toClientDhlConfig(dhlCfg)} />
      </div>
    </section>
  );
}
