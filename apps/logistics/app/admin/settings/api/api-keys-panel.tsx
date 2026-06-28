"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createApiKeyAction,
  revokeApiKeyAction,
} from "../api-actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import {
  API_SCOPE_OPTIONS,
  formatApiScope,
  formatApiTimestamp,
  type ApiKeyRow,
} from "../api/shared";

export function ApiKeysPanel({
  keys,
  baseUrl,
}: {
  keys: ApiKeyRow[];
  baseUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRevealedKey(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createApiKeyAction(fd);
      if (res.ok) {
        setRevealedKey(res.key);
        dispatchAdminJobSuccess({
          title: "API-Schlüssel",
          message: `Schlüssel „${res.label}" erstellt — kopiere ihn jetzt, er wird nicht erneut angezeigt.`,
        });
        e.currentTarget.reset();
        router.refresh();
      } else {
        dispatchAdminJobError({ title: "API-Schlüssel", message: res.error });
      }
    });
  }

  function onRevoke(id: string, label: string) {
    if (
      !window.confirm(
        `API-Schlüssel „${label}" wirklich widerrufen? Externe Integrationen mit diesem Schlüssel funktionieren danach nicht mehr.`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const res = await revokeApiKeyAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "API-Schlüssel",
          message: "Schlüssel widerrufen.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({ title: "API-Schlüssel", message: res.error });
      }
    });
  }

  async function copyKey() {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      dispatchAdminJobSuccess({
        title: "API-Schlüssel",
        message: "Schlüssel in Zwischenablage kopiert.",
      });
    } catch {
      dispatchAdminJobError({
        title: "API-Schlüssel",
        message: "Kopieren fehlgeschlagen — markiere den Schlüssel manuell.",
      });
    }
  }

  return (
    <div className="space-y-8">
      <section className="card p-6">
        <p className="eyebrow">Neuer Schlüssel</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          API-Schlüssel erstellen
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Für n8n, Scripts oder Partner-Integrationen. Der Rohschlüssel wird nur
          einmal nach dem Erstellen angezeigt.
        </p>

        <form onSubmit={onCreate} className="mt-6 space-y-5">
          <div className="max-w-md">
            <label
              htmlFor="api-key-label"
              className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60"
            >
              Bezeichnung
            </label>
            <input
              id="api-key-label"
              name="label"
              type="text"
              required
              maxLength={80}
              placeholder="z. B. n8n Produktion"
              className="mt-1.5 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm"
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
              Berechtigungen
            </legend>
            {API_SCOPE_OPTIONS.map((opt) => (
              <label
                key={opt.scope}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-100 px-3 py-3 hover:bg-zinc-50"
              >
                <input
                  type="checkbox"
                  name={`scope_${opt.scope}`}
                  value="1"
                  defaultChecked
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                />
                <span>
                  <span className="block text-sm font-semibold text-brand-navy">
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block font-mono text-xs text-brand-navy/50">
                    {opt.endpoint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <button
            type="submit"
            disabled={pending}
            className="btn-primary disabled:opacity-50"
          >
            {pending ? "Erstelle…" : "Schlüssel erstellen"}
          </button>
        </form>

        {revealedKey ? (
          <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
              Neuer Schlüssel — nur jetzt sichtbar
            </p>
            <code className="mt-2 block break-all rounded bg-white/80 px-3 py-2 font-mono text-xs text-brand-navy">
              {revealedKey}
            </code>
            <button
              type="button"
              onClick={() => copyKey()}
              className="mt-3 text-sm font-semibold text-brand-burgundy hover:underline"
            >
              In Zwischenablage kopieren
            </button>
          </div>
        ) : null}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-zinc-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-brand-navy">
            Aktive Schlüssel
          </h2>
          <p className="mt-1 text-xs text-brand-navy/60">
            {keys.length === 0
              ? "Noch keine Schlüssel — erstelle einen für externe Zugriffe."
              : `${keys.length} Schlüssel für diesen Mandanten`}
          </p>
        </div>

        {keys.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-brand-navy/50">
            Keine API-Schlüssel
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex flex-wrap items-start justify-between gap-4 px-6 py-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-brand-navy">{k.label}</p>
                  <p className="mt-1 font-mono text-[10px] text-brand-navy/40">
                    {k.id.slice(0, 12)}…
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {k.scopes.map((s) => (
                      <span key={s} className="chip chip-emerald text-[10px]">
                        {formatApiScope(s)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-brand-navy/50">
                    Erstellt {formatApiTimestamp(k.createdAt)}
                    {k.lastUsedAt
                      ? ` · Zuletzt genutzt ${formatApiTimestamp(k.lastUsedAt)}`
                      : " · Noch nicht genutzt"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onRevoke(k.id, k.label)}
                  className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-50"
                >
                  Widerrufen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-6">
        <p className="eyebrow">Referenz</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          REST API v1
        </h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
              Basis-URL
            </dt>
            <dd className="mt-1 font-mono text-xs">{baseUrl}/api/v1</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
              Authentifizierung
            </dt>
            <dd className="mt-1 font-mono text-xs">
              Authorization: Bearer sk_live_…
            </dd>
          </div>
        </dl>
        <pre className="mt-4 overflow-x-auto rounded-md bg-zinc-900 px-4 py-3 text-xs text-zinc-100">
{`curl -s "${baseUrl}/api/v1/orders?status=SHIP" \\
  -H "Authorization: Bearer sk_live_…"`}
        </pre>
        <p className="mt-3 text-xs text-brand-navy/60">
          Antwortformat:{" "}
          <code className="font-mono">{`{ "data": { … }, "meta": { "shop_id": "…" } }`}</code>
        </p>
      </section>
    </div>
  );
}
