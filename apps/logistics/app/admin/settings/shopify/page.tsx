import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { adminDb } from "@/server/firestore/admin";
import { getShop } from "@/server/tenant/shop";
import { productsForShop, variantsForShop } from "@/server/tenant/queries";
import { getLastCompletedProductSyncFinishedAtMs } from "@/server/shopify/product-sync-run";
import { getTranslations } from "next-intl/server";
import { ShopifyConnectForm } from "@/app/_components/shopify-connect-form";
import { ProductSyncButton } from "@/app/admin/products/sync-button";
import { CatalogSyncForm } from "../catalog-sync-form";
import { TestModeForm } from "../test-mode-form";
import { TestModeLogPanel } from "../test-mode-log-panel";
import { loadLagerConfig } from "@/server/lager/config";
import { listTestModeLogEntries } from "@/server/shopify/test-mode";
import { DEFAULT_TEST_MODE } from "@/lib/lager/defaults";
import { HealthPanel, type HealthSnapshot } from "../health-panel";
import { readLastHealth } from "@/server/shopify/health";
import { getMissingOAuthScopes } from "@/server/shopify/scopes";
import { Badge, DefItem } from "../_shared";

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
  const [prodCount, varCount, lastSyncAtMs] = await Promise.all([
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
    getLastCompletedProductSyncFinishedAtMs(shopId),
  ]);

  return {
    productCount: prodCount,
    variantCount: varCount,
    lastSyncAtIso:
      lastSyncAtMs != null ? new Date(lastSyncAtMs).toISOString() : null,
  };
}

export default async function ShopifySettingsPage() {
  const { shopId } = await requireTenantPageContext("/admin/settings/shopify");
  const [status, lastHealth, syncStats, lagerCfg, shop, testModeLog, t] =
    await Promise.all([
    getShopStatus(shopId),
    readLastHealth(shopId),
    getProductSyncStats(shopId),
    loadLagerConfig(shopId),
    getShop(shopId),
    listTestModeLogEntries(shopId, 50),
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
  const testMode = shop?.test_mode ?? DEFAULT_TEST_MODE;

  return (
    <>
      <section className="card p-6">
        <p className="eyebrow">Shopify</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Dein Shopify-Shop
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Verbinde deinen Shop über die normale Shopify-Freigabe — du musst
          nichts manuell eintragen.
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="Verbunden">
            <Badge ok={status.token_installed} />
          </DefItem>
          <DefItem label="Shop">
            <span className="font-mono text-xs">
              {status.token_shop_domain ?? "—"}
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
                  Bitte Shopify unten erneut verbinden, damit alle Funktionen
                  weiterlaufen.
                </p>
              </div>
            ) : null}
            {!healthSnap?.tokenValid ? (
              <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-4 py-3 text-sm text-brand-burgundy-dark">
                <p className="font-semibold">Verbindung ungültig oder abgelaufen</p>
                <p className="mt-1 text-xs">
                  Bitte Shopify erneut freigeben.
                </p>
              </div>
            ) : null}
            <p className="text-xs text-brand-navy/60">
              Nach App-Updates oder neuen Berechtigungen Shopify einmal neu
              verbinden.
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
          Verbindungsstatus
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Prüft, ob Bestellungen und Bestände zuverlässig synchronisiert
          werden. Fehlende Verknüpfungen werden automatisch repariert.
        </p>
        <div className="mt-5">
          <HealthPanel initial={healthSnap} />
        </div>
      </section>

      {status.token_installed ? (
        <>
          <section className="card p-6">
            <p className="eyebrow">Testmodus</p>
            <h2 className="mt-1 text-sm font-semibold text-brand-navy">
              Sicheres Testen
            </h2>
            <p className="mt-1 text-xs text-brand-navy/60">
              Im Testmodus bleibt Shopify unverändert. Die App arbeitet normal
              weiter; geplante Schreibzugriffe werden protokolliert.
            </p>
            <div className="mt-5">
              <TestModeForm current={{ test_mode: testMode }} />
            </div>
          </section>

          <section className="card p-6">
            <p className="eyebrow">Testmodus-Protokoll</p>
            <h2 className="mt-1 text-sm font-semibold text-brand-navy">
              Geplante Shopify-Änderungen
            </h2>
            <p className="mt-1 text-xs text-brand-navy/60">
              Was die App zu Shopify senden würde, wenn der Testmodus aus ist.
            </p>
            <div className="mt-5">
              <TestModeLogPanel rows={testModeLog} />
            </div>
          </section>

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
                  {syncStats.lastSyncAtIso
                    ? new Date(syncStats.lastSyncAtIso).toLocaleString("de-DE")
                    : t("stats.never")}
                </span>
              </DefItem>
            </dl>
            <div className="mt-5">
              <ProductSyncButton />
            </div>
          </section>

          <section className="card p-6">
            <p className="eyebrow">Katalog</p>
            <h2 className="mt-1 text-sm font-semibold text-brand-navy">
              Produkt-Editor → Shopify
            </h2>
            <p className="mt-1 text-xs text-brand-navy/60">
              Steuert, ob Änderungen aus dem Produkt-Editor standardmäßig zurück
              zu Shopify geschrieben werden.
            </p>
            <div className="mt-5">
              <CatalogSyncForm
                current={{
                  catalog_sync_to_shopify: lagerCfg.catalog_sync_to_shopify,
                }}
              />
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
