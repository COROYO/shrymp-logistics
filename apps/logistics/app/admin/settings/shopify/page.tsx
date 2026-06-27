import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { getShop } from "@/server/tenant/shop";
import { ShopifyConnectForm } from "@/app/_components/shopify-connect-form";
import { RegisterWebhooksButton } from "../register-webhooks-button";
import { HealthPanel, type HealthSnapshot } from "../health-panel";
import { readLastHealth } from "@/server/shopify/health";
import { Badge, DefItem, getEnvHealth } from "../_shared";

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

export default async function ShopifySettingsPage() {
  const { shopId } = await requireTenantPageContext("/admin/settings/shopify");
  const [status, env, lastHealth] = await Promise.all([
    getShopStatus(shopId),
    Promise.resolve(getEnvHealth()),
    readLastHealth(shopId),
  ]);

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
    <>
      <section className="card p-6">
        <p className="eyebrow">Shopify</p>
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
          werden automatisch nachregistriert.
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
          Registriert Webhook-Subscriptions bei Shopify. Idempotent — wird durch
          den Health-Check ohnehin automatisch ausgeführt.
        </p>
        <div className="mt-5">
          <RegisterWebhooksButton baseUrl={env.appUrl} />
        </div>
      </section>
    </>
  );
}
