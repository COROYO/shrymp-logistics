import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { adminDb } from "@/server/firestore/admin";
import { getShop } from "@/server/tenant/shop";
import { productsForShop, variantsForShop } from "@/server/tenant/queries";
import { getTranslations } from "next-intl/server";
import { ShopifyConnectForm } from "@/app/_components/shopify-connect-form";
import { ProductSyncButton } from "@/app/admin/products/sync-button";
import { RegisterWebhooksButton } from "../register-webhooks-button";
import { HealthPanel, type HealthSnapshot } from "../health-panel";
import { readLastHealth } from "@/server/shopify/health";
import { getMissingOAuthScopes } from "@/server/shopify/scopes";
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

async function getProductSyncStats(shopId: string) {
  const db = adminDb();
  const [prodCount, varCount, shop] = await Promise.all([
    productsForShop(db, shopId)
      .count()
      .get()
      .then((s) => s.data().count)
      .catch(() => 0),
    variantsForShop(db, shopId)
      .count()
      .get()
      .then((s) => s.data().count)
      .catch(() => 0),
    getShop(shopId),
  ]);

  const updatedAt = shop?.updated_at;
  let updatedAtIso: string | null = null;
  const ts = updatedAt as unknown as { toDate?: () => Date };
  if (ts && typeof ts.toDate === "function") {
    updatedAtIso = ts.toDate().toISOString();
  }

  return { productCount: prodCount, variantCount: varCount, updatedAtIso };
}

export default async function ShopifySettingsPage() {
  const { shopId } = await requireTenantPageContext("/admin/settings/shopify");
  const [status, env, lastHealth, syncStats, t] = await Promise.all([
    getShopStatus(shopId),
    Promise.resolve(getEnvHealth()),
    readLastHealth(shopId),
    getProductSyncStats(shopId),
    getTranslations("products"),
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
  const missingScopes = getMissingOAuthScopes(status.token_scope);
  const reconnectHref = status.token_shop_domain
    ? `/api/shopify/install?${new URLSearchParams({ shop: status.token_shop_domain }).toString()}`
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
          <DefItem label="App installiert">
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
        ) : (
          <div className="mt-5 space-y-4">
            {missingScopes.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">
                  Neue Berechtigungen erforderlich
                </p>
                <p className="mt-1 text-xs">
                  Fehlende Scopes:{" "}
                  <span className="font-mono">{missingScopes.join(", ")}</span>
                </p>
              </div>
            ) : null}
            {!healthSnap?.tokenValid ? (
              <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-4 py-3 text-sm text-brand-burgundy-dark">
                <p className="font-semibold">Token ungültig oder abgelaufen</p>
                <p className="mt-1 text-xs">
                  Bitte Shopify erneut freigeben, um einen neuen Access Token zu
                  erhalten.
                </p>
              </div>
            ) : null}
            <p className="text-xs text-brand-navy/60">
              Nach App-Updates oder neuen Berechtigungen Shopify einmal neu
              verbinden — du wirst nur zur Freigabe weitergeleitet.
            </p>
            {reconnectHref ? (
              <a
                href={reconnectHref}
                className="btn-primary inline-block !py-3"
              >
                Shopify neu verbinden
              </a>
            ) : (
              <ShopifyConnectForm
                initialShopDomain={status.token_shop_domain}
                submitLabel="Shopify neu verbinden"
                compact
              />
            )}
          </div>
        )}
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

      {status.token_installed ? (
        <>
          <section className="card p-6">
            <p className="eyebrow">Standorte</p>
            <h2 className="mt-1 text-sm font-semibold text-brand-navy">
              Multi-Location Bestand
            </h2>
            <p className="mt-1 text-xs text-brand-navy/60">
              Standorte syncen, Standard-Lager festlegen und neue Shopify
              Locations anlegen — unter{" "}
              <a
                href="/admin/settings/standorte"
                className="font-semibold text-brand-burgundy underline"
              >
                Einstellungen → Standorte
              </a>
              .
            </p>
          </section>

          <section className="card p-6">
            <p className="eyebrow">{t("sync.eyebrow")}</p>
            <h2 className="mt-1 text-sm font-semibold text-brand-navy">
              {t("sync.title")}
            </h2>
            <p className="mt-1 text-xs text-brand-navy/60">{t("sync.intro")}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <DefItem label={t("stats.products")}>
                <span className="font-bold tabular-nums">
                  {syncStats.productCount}
                </span>
              </DefItem>
              <DefItem label={t("stats.variants")}>
                <span className="font-bold tabular-nums">
                  {syncStats.variantCount}
                </span>
              </DefItem>
              <DefItem label={t("stats.lastSync")}>
                <span className="font-mono text-xs">
                  {syncStats.updatedAtIso
                    ? new Date(syncStats.updatedAtIso).toLocaleString("de-DE")
                    : t("stats.never")}
                </span>
              </DefItem>
            </dl>
            <div className="mt-5">
              <ProductSyncButton />
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
