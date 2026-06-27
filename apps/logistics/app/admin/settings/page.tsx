import {
  type DhlConfig,
  type LagerConfig,
} from "@/server/firestore/schema";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { getShop } from "@/server/tenant/shop";
import { loadLagerConfig } from "@/server/lager/config";
import { loadDhlConfig } from "@/server/dhl/config";
import { loadSlipBranding } from "@/server/slip/branding";
import { ShopifyConnectForm } from "@/app/_components/shopify-connect-form";
import { RegisterWebhooksButton } from "./register-webhooks-button";
import { RunAllocationButton } from "./run-allocation-button";
import { BackfillOrdersButton } from "./backfill-orders-button";
import { PushInventoryButton } from "./push-inventory-button";
import { DhlConfigForm, type DhlConfigFormValue } from "./dhl-config-form";
import { LagerConfigForm } from "./lager-config-form";
import { SlipBrandingForm } from "./slip-branding-form";
import { HealthPanel, type HealthSnapshot } from "./health-panel";
import { readLastHealth } from "@/server/shopify/health";

export const dynamic = "force-dynamic";

async function getShopStatus(shopId: string) {
  const shop = await getShop(shopId);
  return {
    token_installed: !!(shop?.access_token && shop.status === "ACTIVE"),
    token_shop_domain: shop?.shop_domain ?? null,
    token_scope: shop?.scope ?? null,
    location_gid: shop?.location_gid ?? null,
    api_version: shop?.api_version ?? null,
  };
}

async function getLagerConfig(shopId: string): Promise<LagerConfig> {
  return loadLagerConfig(shopId);
}

async function getDhlConfig(shopId: string): Promise<DhlConfig | null> {
  return loadDhlConfig(shopId);
}

/** Drop the Firestore Timestamp + the raw password before sending to a client component. */
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

function getEnvHealth() {
  return {
    apiKey: !!process.env.SHOPIFY_API_KEY,
    apiSecret: !!process.env.SHOPIFY_API_SECRET,
    apiVersion: process.env.SHOPIFY_API_VERSION ?? null,
    allocationQueue: !!process.env.ALLOCATION_QUEUE,
    allocationTargetUrl: process.env.ALLOCATION_TARGET_URL ?? null,
    appUrl: process.env.APP_BASE_URL ?? null,
    dhlApiKey: !!process.env.DHL_API_KEY,
    dhlApiSecret: !!process.env.DHL_API_SECRET,
  };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string }>;
}) {
  const { shopId } = await requireTenantPageContext("/admin/settings");
  const [status, lagerCfg, dhlCfg, slipBranding, env, sp, lastHealth] =
    await Promise.all([
    getShopStatus(shopId),
    getLagerConfig(shopId),
    getDhlConfig(shopId),
    loadSlipBranding(shopId),
    Promise.resolve(getEnvHealth()),
    searchParams,
    readLastHealth(shopId),
  ]);
  const justInstalled = sp.installed === "1";

  const healthSnap: HealthSnapshot | null = lastHealth
    ? {
        ok: lastHealth.ok,
        tokenValid: lastHealth.tokenValid,
        shop: lastHealth.shop,
        webhooks: lastHealth.webhooks,
        errors: lastHealth.errors,
        checkedAt: lastHealth.checkedAt,
      }
    : null;

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">System</p>
        <h1 className="h-display mt-1 text-3xl">Einstellungen</h1>
      </div>

      {justInstalled ? (
        <div className="space-y-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Shopify erfolgreich verbunden. Als Nächstes: Produkte syncen, Orders
            nachladen, optional DHL konfigurieren.
          </div>
          <ol className="list-decimal list-inside space-y-2 rounded-md border border-zinc-200 bg-white px-4 py-4 text-sm text-brand-navy">
            <li>
              <strong>Produkte syncen</strong> unter{" "}
              <a href="/admin/products" className="text-brand-burgundy underline">
                Produkte
              </a>
            </li>
            <li>
              <strong>Offene Orders nachladen</strong> (Button unten bei Orders)
            </li>
            <li>
              <strong>Verbindung prüfen</strong> — Health-Check startet Webhooks
            </li>
            <li>
              <strong>DHL konfigurieren</strong> (falls Versandlabels gewünscht)
            </li>
          </ol>
        </div>
      ) : null}

      <section className="card p-6">
        <p className="eyebrow">Shopify-Verbindung</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Dein Shopify-Shop
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Die Verbindung läuft über OAuth — du musst keine API-Keys eintragen.
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="App installiert (Token in Firestore)">
            <Badge ok={status.token_installed} />
          </DefItem>
          <DefItem label="Shop">
            <span className="font-mono text-xs">
              {status.token_shop_domain ?? "—"}
            </span>
          </DefItem>
          <DefItem label="Gewährte Scopes">
            <span className="font-mono text-xs break-all">
              {status.token_scope ?? "—"}
            </span>
          </DefItem>
          <DefItem label="API Version">
            <span className="font-mono">
              {status.api_version ?? env.apiVersion ?? "—"}
            </span>
          </DefItem>
          <DefItem label="Location GID">
            <span className="font-mono text-xs">
              {status.location_gid ?? "— (wird beim Produkt-Sync gesetzt)"}
            </span>
          </DefItem>
        </dl>

        {!status.token_installed ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Noch nicht verbunden.</p>
              <p className="mt-1 text-xs">
                Shop-Domain eingeben und auf Verbinden klicken — Shopify fragt
                nur die App-Freigabe ab.
              </p>
            </div>
            <ShopifyConnectForm
              initialShopDomain={status.token_shop_domain}
              compact
            />
          </div>
        ) : null}
      </section>

      <section className="card p-6">
        <p className="eyebrow">Verbindung</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Health-Check & Auto-Heal
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Prüft Access-Token und alle Webhook-Subscriptions. Fehlende Webhooks
          werden automatisch nachregistriert — damit die App nicht
          &quot;auseinanderfällt&quot;, wenn Shopify einen Endpoint kurzzeitig verliert.
        </p>
        <div className="mt-5">
          <HealthPanel initial={healthSnap} />
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">Webhooks</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Subscriptions registrieren (manuell)
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Registriert Webhook-Subscriptions bei Shopify (orders/create,
          orders/updated, orders/cancelled, inventory_levels/update,
          app/uninstalled). Idempotent. Wird durch den Health-Check oben
          ohnehin automatisch ausgeführt — dieser Button ist nur für Notfälle.
        </p>
        <div className="mt-5">
          <RegisterWebhooksButton baseUrl={env.appUrl} />
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">Bestand</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Bestände nach Shopify pushen
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Schreibt für jede Variante den aktuellen <code>available</code>-Wert
          (= <code>on_hand_total − reserved_total</code>) per
          <code> inventorySetOnHandQuantities</code> nach Shopify. Nötig nach
          dem ersten Wareneingang oder wenn manuelle Shopify-Inventory-Edits
          Drift erzeugt haben. Einzel-Mutationen pushen sowieso schon nach
          jedem Event.
        </p>
        <div className="mt-5">
          <PushInventoryButton />
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">Orders</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Orders nachladen (Backfill)
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Pullt alle <em>offenen, unfulfilled</em> Orders aus Shopify in unsere
          Datenbank. Nötig nach dem ersten App-Install — Webhooks feuern nur
          für neue/geänderte Orders, nicht rückwirkend.
        </p>
        <div className="mt-5">
          <BackfillOrdersButton />
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">DHL Versand</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          DHL Parcel DE Shipping API
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Erzeugt Versandetiketten direkt aus dem Packing-Screen. Inland (DE)
          geht über die DHL Parcel DE Shipping API v2. Auslandsversand
          (Express) bleibt via externem DHL-Tool.
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
              {dhlCfg
                ? dhlCfg.sandbox
                  ? "Sandbox"
                  : "Production"
                : "—"}
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

      <section className="card p-6">
        <p className="eyebrow">Lager</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Chargen-Zuordnung (MHD-Sperre)
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="Mindest-Restlaufzeit">
            <span className="font-mono text-xs">
              {lagerCfg.batch_min_days_before_expiry} Tage
            </span>
          </DefItem>
        </dl>
        <div className="mt-6">
          <LagerConfigForm
            current={{
              batch_min_days_before_expiry:
                lagerCfg.batch_min_days_before_expiry,
            }}
          />
        </div>
      </section>

      <section className="card p-6">
        <p className="eyebrow">Lieferschein</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Branding & Layout
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Markenname, Farben und Footer für den gedruckten Lieferschein — pro
          Shop individuell. Tabellen-Labels (Produkt, Menge, Charge) bleiben
          auf Deutsch.
        </p>
        <div className="mt-6">
          <SlipBrandingForm current={slipBranding} />
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
    </div>
  );
}

function DefItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-brand-ink">{children}</dd>
    </div>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      className={ok ? "chip chip-emerald" : "chip chip-amber"}
    >
      {ok ? "OK" : "fehlt"}
    </span>
  );
}
