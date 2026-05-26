import { adminDb } from "@/server/firestore/admin";
import { Collections, ConfigDocs } from "@/server/firestore/schema";
import { RegisterWebhooksButton } from "./register-webhooks-button";
import { RunAllocationButton } from "./run-allocation-button";

export const dynamic = "force-dynamic";

async function getStatus() {
  const db = adminDb();
  const [metaSnap, tokenSnap] = await Promise.all([
    db.collection(Collections.Config).doc(ConfigDocs.ShopifyMeta).get(),
    db.collection(Collections.Config).doc(ConfigDocs.ShopifyToken).get(),
  ]);
  const meta = metaSnap.exists ? metaSnap.data() : null;
  const token = tokenSnap.exists ? tokenSnap.data() : null;
  return {
    token_installed: !!token,
    token_shop_domain: (token?.["shop_domain"] as string | undefined) ?? null,
    token_scope: (token?.["scope"] as string | undefined) ?? null,
    location_gid: (meta?.["location_gid"] as string | undefined) ?? null,
    api_version: (meta?.["api_version"] as string | undefined) ?? null,
  };
}

function getEnvHealth() {
  return {
    apiKey: !!process.env.SHOPIFY_API_KEY,
    apiSecret: !!process.env.SHOPIFY_API_SECRET,
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN ?? null,
    apiVersion: process.env.SHOPIFY_API_VERSION ?? null,
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
  const [status, env, sp] = await Promise.all([
    getStatus(),
    Promise.resolve(getEnvHealth()),
    searchParams,
  ]);
  const justInstalled = sp.installed === "1";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1>

      {justInstalled ? (
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Shopify-App erfolgreich installiert. Access-Token in Firestore
          gespeichert.
        </div>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Shopify App (Custom Distribution)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Die App authentifiziert sich mit Client ID + Client Secret. Beim
          ersten Install klickt der Shop-Owner den vom Partner Dashboard
          generierten Install-Link — Shopify ruft daraufhin{" "}
          <code>/api/shopify/callback</code> auf, der Token landet in Firestore.
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <DefItem label="Client ID (env)">
            <Badge ok={env.apiKey} />
          </DefItem>
          <DefItem label="Client Secret (env)">
            <Badge ok={env.apiSecret} />
          </DefItem>
          <DefItem label="App installiert (Token in Firestore)">
            <Badge ok={status.token_installed} />
          </DefItem>
          <DefItem label="Installiert für Shop">
            <span className="font-mono text-xs">
              {status.token_shop_domain ?? "—"}
            </span>
          </DefItem>
          <DefItem label="Gewährte Scopes">
            <span className="font-mono text-xs">
              {status.token_scope ?? "—"}
            </span>
          </DefItem>
          <DefItem label="API Version">
            <span className="font-mono">{status.api_version ?? env.apiVersion ?? "—"}</span>
          </DefItem>
          <DefItem label="Erwarteter Shop (env)">
            <span className="font-mono text-xs">{env.shopDomain ?? "—"}</span>
          </DefItem>
          <DefItem label="Location GID">
            <span className="font-mono text-xs">
              {status.location_gid ?? "— (wird beim Produkt-Sync gesetzt)"}
            </span>
          </DefItem>
        </dl>

        {!status.token_installed ? (
          <div className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
            <p className="font-semibold">Noch nicht installiert.</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Im Partner Dashboard die App-Settings öffnen.</li>
              <li>
                <strong>App URL</strong> und{" "}
                <strong>Allowed redirection URL(s)</strong> beide auf{" "}
                <code>{env.appUrl ? `${stripScheme(env.appUrl)}/api/shopify/callback` : "<APP_BASE_URL>/api/shopify/callback"}</code>{" "}
                setzen.
              </li>
              <li>Den Install-Link aus dem Partner Dashboard öffnen (einmaliger Klick).</li>
              <li>Shopify ruft danach automatisch <code>/api/shopify/callback</code> auf — Token landet hier in Firestore.</li>
            </ol>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Webhooks</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Registriert Webhook-Subscriptions bei Shopify (orders/create,
          orders/updated, orders/cancelled, inventory_levels/update,
          app/uninstalled). Idempotent. Setzt voraus, dass die App installiert
          ist.
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

function stripScheme(s: string): string {
  return s.replace(/\/$/, "");
}
