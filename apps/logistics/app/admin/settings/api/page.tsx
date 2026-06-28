import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { listApiKeysForShop } from "@/server/api/keys";
import { ApiKeysPanel } from "./api-keys-panel";
import { tsToIso, type ApiKeyRow } from "../api/shared";

export const dynamic = "force-dynamic";

function apiBaseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "http://localhost:3000";
}

export default async function ApiSettingsPage() {
  const { shopId } = await requireTenantPageContext("/admin/settings/api");
  const keys = await listApiKeysForShop(shopId);

  const rows: ApiKeyRow[] = keys.map((k) => ({
    id: k.id,
    label: k.label,
    scopes: k.scopes,
    createdAt: tsToIso(k.created_at) ?? "",
    lastUsedAt: tsToIso(k.last_used_at),
  }));

  return <ApiKeysPanel keys={rows} baseUrl={apiBaseUrl()} />;
}
