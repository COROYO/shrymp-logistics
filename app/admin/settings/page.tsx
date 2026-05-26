import { adminDb } from "@/server/firestore/admin";
import { Collections, ConfigDocs } from "@/server/firestore/schema";
import { RegisterWebhooksButton } from "./register-webhooks-button";
import { RunAllocationButton } from "./run-allocation-button";
import { InstallShopifyAppLink } from "./install-shopify-button";

export const dynamic = "force-dynamic";

async function getConfig() {
  const db = adminDb();
  const [metaSnap, tokenSnap] = await Promise.all([
    db
      .collection(Collections.Config)
      .doc(ConfigDocs.ShopifyMeta)
      .get(),
    db
      .collection(Collections.Config)
      .doc(ConfigDocs.ShopifyToken)
      .get(),
  ]);
  const meta = metaSnap.exists ? metaSnap.data() : null;
  const token = tokenSnap.exists ? tokenSnap.data() : null;
  return {
    shop_domain: (meta?.["shop_domain"] as string | undefined) ?? null,
    location_gid: (meta?.["location_gid"] as string | undefined) ?? null,
    api_version: (meta?.["api_version"] as string | undefined) ?? null,
    token_installed: !!token,
    token_shop_domain: (token?.["shop_domain"] as string | undefined) ?? null,
    token_scope: (token?.["scope"] as string | undefined) ?? null,
  };
}

async function getEnvHealth() {
  return {
    apiKey: !!process.env.SHOPIFY_API_KEY,
    apiSecret: !!process.env.SHOPIFY_API_SECRET,
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN ?? null,
    scopes: process.env.SHOPIFY_SCOPES ?? null,
    allocationQueue: !!process.env.ALLOCATION_QUEUE,
    allocationTargetUrl: process.env.ALLOCATION_TARGET_URL ?? null,
    appUrl: process.env.APP_BASE_URL ?? null,
  };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string }>;
}) {
  const [config, env, sp] = await Promise.all([
    getConfig(),
    getEnvHealth(),
    searchParams,
  ]);
  const justInstalled = sp.installed === "1";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>

      {justInstalled ? (
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Shopify-App erfolgreich installiert. Access-Token gespeichert.
        </div>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Shopify App</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Die App authentifiziert sich mit Client ID + Client Secret. Der
          Admin-API-Token wird über den OAuth-Install-Flow geholt und in
          Firestore gespeichert.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="Client ID (env)">
            <Badge ok={env.apiKey} />
          </DefItem>
          <DefItem label="Client Secret (env)">
            <Badge ok={env.apiSecret} />
          </DefItem>
          <DefItem label="App installiert (Token in Firestore)">
            <Badge ok={config.token_installed} />
          </DefItem>
          <DefItem label="Installiert für Shop">
            <span className="font-mono">
              {config.token_shop_domain ?? "—"}
            </span>
          </DefItem>
          <DefItem label="Gewährte Scopes">
            <span className="font-mono text-xs">
              {config.token_scope ?? "—"}
            </span>
          </DefItem>
          <DefItem label="API Version">
            <span className="font-mono">{config.api_version ?? "—"}</span>
          </DefItem>
          <DefItem label="Konfigurierte Scopes (env)">
            <span className="font-mono text-xs">
              {env.scopes ?? "—"}
            </span>
          </DefItem>
        </dl>
        <div className="mt-4">
          <InstallShopifyAppLink
            shopDomain={env.shopDomain}
            installed={config.token_installed}
          />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Webhooks</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Registriert die nötigen Webhook-Subscriptions bei Shopify
          (orders/create, orders/updated, orders/cancelled, inventory_levels/update,
          app/uninstalled). Idempotent — bestehende werden nicht doppelt erzeugt.
        </p>
        <div className="mt-4">
          <RegisterWebhooksButton baseUrl={env.appUrl} />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Allocation</h2>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="Queue konfiguriert">
            <Badge ok={env.allocationQueue} />
          </DefItem>
          <DefItem label="Target URL">
            <span className="font-mono text-xs">
              {env.allocationTargetUrl ?? "—"}
            </span>
          </DefItem>
        </dl>
        <div className="mt-4">
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
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {ok ? "OK" : "fehlt"}
    </span>
  );
}
