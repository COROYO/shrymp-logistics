"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runHealthCheckAction } from "./actions";

export type HealthSnapshot = {
  ok: boolean;
  tokenValid: boolean;
  shop: string | null;
  webhooks: Array<{
    topic: string;
    present: boolean;
    callbackUrl: string | null;
    expected: string;
  }>;
  errors: string[];
  checkedAt: string | null;
};

const WEBHOOK_LABELS: Record<string, string> = {
  "orders/create": "Neue Bestellungen",
  "orders/updated": "Bestellungsänderungen",
  "orders/edited": "Bearbeitete Bestellungen",
  "orders/cancelled": "Stornierungen",
  "inventory_levels/update": "Bestandsänderungen",
  "app/uninstalled": "App deinstalliert",
};

function webhookLabel(topic: string): string {
  return WEBHOOK_LABELS[topic] ?? topic;
}

/**
 * Live connection health widget. Shows the last persisted health snapshot
 * and offers a manual check + repair button.
 */
export function HealthPanel({ initial }: { initial: HealthSnapshot | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [snap, setSnap] = useState<HealthSnapshot | null>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [justRepaired, setJustRepaired] = useState<string[]>([]);

  function handleCheck() {
    setErr(null);
    setJustRepaired([]);
    start(async () => {
      const res = await runHealthCheckAction();
      if ("error" in res && res.checkedAt === undefined) {
        setErr(res.error);
        return;
      }
      const repaired = res.webhooks
        .filter((w) => w.repaired)
        .map((w) => w.topic);
      setJustRepaired(repaired);
      setSnap({
        ok: res.ok,
        tokenValid: res.tokenValid,
        shop: snap?.shop ?? null,
        webhooks: res.webhooks.map((w) => ({
          topic: w.topic,
          present: w.present,
          callbackUrl: null,
          expected: "",
        })),
        errors: res.errors,
        checkedAt: res.checkedAt,
      });
      router.refresh();
    });
  }

  const status = !snap
    ? { label: "Noch nicht geprüft", color: "amber" as const }
    : snap.ok
      ? { label: "Verbunden", color: "emerald" as const }
      : { label: "Aktion erforderlich", color: "burgundy" as const };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              status.color === "emerald"
                ? "bg-emerald-500"
                : status.color === "amber"
                  ? "bg-amber-500"
                  : "bg-brand-burgundy"
            } ${status.color === "emerald" ? "" : "animate-pulse"}`}
            aria-hidden
          />
          <span className="text-sm font-semibold text-brand-navy">
            {status.label}
          </span>
          {snap?.checkedAt ? (
            <span className="text-[11px] text-brand-navy/60">
              · {formatRelative(snap.checkedAt)}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleCheck}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md border border-brand-navy/30 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-navy/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Prüfe…" : "Jetzt prüfen + reparieren"}
        </button>
      </div>

      {snap ? (
        <div className="rounded-md border border-zinc-200 bg-white">
          <Row
            label="Shopify-Verbindung"
            ok={snap.tokenValid}
            hint={
              snap.tokenValid
                ? snap.shop ?? null
                : "Verbindung ungültig oder App deinstalliert — bitte Shopify erneut freigeben."
            }
          />
          {snap.webhooks.map((w) => (
            <Row
              key={w.topic}
              label={webhookLabel(w.topic)}
              ok={w.present}
              hint={
                w.present
                  ? justRepaired.includes(w.topic)
                    ? "Automatisch repariert."
                    : null
                  : "Fehlt — wird im Hintergrund nachregistriert."
              }
              repaired={justRepaired.includes(w.topic)}
            />
          ))}
        </div>
      ) : null}

      {snap?.errors && snap.errors.length > 0 ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-xs text-brand-burgundy-dark">
          <ul className="space-y-1">
            {snap.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {err ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-xs text-brand-burgundy-dark">
          {err}
        </div>
      ) : null}

      <p className="text-[11px] text-brand-navy/60">
        Diese Prüfung läuft automatisch alle 15 Minuten im Hintergrund.
      </p>
    </div>
  );
}

function Row({
  label,
  ok,
  hint,
  repaired,
}: {
  label: string;
  ok: boolean;
  hint?: string | null;
  repaired?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-3 py-2 last:border-b-0">
      <div>
        <div className="text-sm font-medium text-brand-navy">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-[11px] text-brand-navy/60">{hint}</div>
        ) : null}
      </div>
      <span
        className={
          ok
            ? repaired
              ? "chip chip-violet"
              : "chip chip-emerald"
            : "chip chip-burgundy"
        }
      >
        {ok ? (repaired ? "Repariert" : "OK") : "Fehlt"}
      </span>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "gerade eben";
    if (diff < 3600) return `vor ${Math.round(diff / 60)} Min`;
    if (diff < 86400) return `vor ${Math.round(diff / 3600)} h`;
    return d.toLocaleString("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}
