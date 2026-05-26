import { adminDb } from "@/server/firestore/admin";
import { Collections, ConfigDocs } from "@/server/firestore/schema";
import { RegisterWebhooksButton } from "./register-webhooks-button";
import { RunAllocationButton } from "./run-allocation-button";

export const dynamic = "force-dynamic";

async function getConfig() {
  const db = adminDb();
  const snap = await db
    .collection(Collections.Config)
    .doc(ConfigDocs.ShopifyMeta)
    .get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  return {
    shop_domain: (d["shop_domain"] as string | undefined) ?? null,
    location_gid: (d["location_gid"] as string | undefined) ?? null,
    api_version: (d["api_version"] as string | undefined) ?? null,
  };
}

function getEnvHealth() {
  return {
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN ?? null,
    apiKey: !!process.env.SHOPIFY_API_KEY,
    apiSecret: !!process.env.SHOPIFY_API_SECRET,
    adminToken: !!process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    apiVersion: process.env.SHOPIFY_API_VERSION ?? null,
    allocationQueue: !!process.env.ALLOCATION_QUEUE,
    allocationTargetUrl: process.env.ALLOCATION_TARGET_URL ?? null,
    appUrl: process.env.APP_BASE_URL ?? null,
  };
}

export default async function SettingsPage() {
  const config = await getConfig();
  const env = getEnvHealth();
  const allShopifyEnvOK = env.apiKey && env.apiSecret && env.adminToken;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Shopify Custom App</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Die App ist als Custom App im Shopify Admin installiert. Credentials
          kommen direkt aus den Server-ENV.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="Shop">
            <span className="font-mono">{env.shopDomain ?? "—"}</span>
          </DefItem>
          <DefItem label="API Version">
            <span className="font-mono">{env.apiVersion ?? "—"}</span>
          </DefItem>
          <DefItem label="Admin API Access Token">
            <Badge ok={env.adminToken} />
          </DefItem>
          <DefItem label="Client Secret (Webhook HMAC)">
            <Badge ok={env.apiSecret} />
          </DefItem>
          <DefItem label="Client ID">
            <Badge ok={env.apiKey} />
          </DefItem>
          <DefItem label="Location GID">
            <span className="font-mono text-xs">
              {config?.location_gid ?? "— (wird beim Produkt-Sync gesetzt)"}
            </span>
          </DefItem>
        </dl>
        {!allShopifyEnvOK ? (
          <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Es fehlen noch ENV-Vars. Setze sie in <code>.env.local</code> (lokal)
            bzw. im Hosting-Provider und starte neu.
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Webhooks</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Registriert die Webhook-Subscriptions bei Shopify
          (orders/create, orders/updated, orders/cancelled, inventory_levels/update,
          app/uninstalled). Idempotent.
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
