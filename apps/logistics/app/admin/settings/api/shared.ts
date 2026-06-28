export const API_SCOPES = [
  "orders:read",
  "inventory:read",
  "batches:read",
] as const;

export type ClientApiScope = (typeof API_SCOPES)[number];

export type ApiKeyRow = {
  id: string;
  label: string;
  scopes: ClientApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
};

export const API_SCOPE_OPTIONS: {
  scope: ClientApiScope;
  label: string;
  endpoint: string;
}[] = [
  {
    scope: "orders:read",
    label: "Aufträge lesen",
    endpoint: "GET /api/v1/orders",
  },
  {
    scope: "inventory:read",
    label: "Lagerbestand lesen",
    endpoint: "GET /api/v1/inventory",
  },
  {
    scope: "batches:read",
    label: "Chargen lesen",
    endpoint: "GET /api/v1/batches",
  },
];

export function formatApiScope(scope: ClientApiScope): string {
  const hit = API_SCOPE_OPTIONS.find((o) => o.scope === scope);
  return hit?.label ?? scope;
}

function tsToIso(t: unknown): string | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  if (t instanceof Date) return t.toISOString();
  return null;
}

export function formatApiTimestamp(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export { tsToIso };
