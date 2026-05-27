"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildDhlLinks } from "@/lib/dhl-links";
import { createDhlLabelAction } from "../actions";

/**
 * Per-order DHL label panel.
 *
 *   - DE shipments → real DHL Parcel DE Shipping API (POST /orders).
 *     PDF is uploaded to Firebase Storage and opened in a new tab.
 *     Shipment number is persisted on the order and used as tracking
 *     number for the Shopify fulfillment step.
 *
 *   - Non-DE shipments → keep the legacy external link to
 *     "DHL Express Commerce" since the Express API is not wired up yet.
 *
 * `existingShipment` is the persisted `dhl_shipment` field — when present
 * we show "Etikett öffnen" / Tracking-Nr instead of "Etikett erstellen".
 */
export function DhlLabelButtons({
  orderId,
  shopDomain,
  countryCode,
  existingShipment,
  defaultWeightG,
  cod,
}: {
  orderId: string;
  shopDomain: string;
  countryCode: string | null;
  existingShipment: {
    shipment_no: string;
    label_url?: string;
    tracking_url: string;
    weight_g: number;
    sandbox: boolean;
  } | null;
  defaultWeightG: number;
  /**
   * COD context when the shipping method indicates Nachnahme.
   * `defaultAmountCents` = best-effort amount from Shopify.
   */
  cod: {
    required: boolean;
    defaultAmountCents: number | null;
  };
}) {
  const isInternational = !!countryCode && countryCode.toUpperCase() !== "DE";

  if (isInternational) {
    const { express } = buildDhlLinks(orderId, shopDomain);
    return (
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={express}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-navy-soft"
        >
          DHL Express Etikett
          <ExternalIcon />
        </a>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/60">
          Auslandsversand ({countryCode}) — DHL Express
        </span>
      </div>
    );
  }

  if (existingShipment) {
    return (
      <ExistingLabelPanel
        orderId={orderId}
        shipment={existingShipment}
        defaultWeightG={defaultWeightG}
        cod={cod}
      />
    );
  }

  return (
    <CreateLabelPanel
      orderId={orderId}
      defaultWeightG={defaultWeightG}
      cod={cod}
    />
  );
}

/** Parse a German-formatted EUR string ("12,34" or "12.34") to integer cents. */
function parseEuroToCents(s: string): number | null {
  const normalized = s.trim().replace(",", ".");
  if (!normalized) return null;
  const m = normalized.match(/^(-?\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = parseInt(m[1] ?? "0", 10);
  const frac = parseInt(((m[2] ?? "") + "00").slice(0, 2), 10);
  if (!Number.isFinite(whole) || whole < 0) return null;
  return whole * 100 + frac;
}

function centsToEuroInput(cents: number | null): string {
  if (cents == null) return "";
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole},${frac.toString().padStart(2, "0")}`;
}

function CreateLabelPanel({
  orderId,
  defaultWeightG,
  cod,
}: {
  orderId: string;
  defaultWeightG: number;
  cod: { required: boolean; defaultAmountCents: number | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [weight, setWeight] = useState<string>(String(defaultWeightG));
  const [codAmount, setCodAmount] = useState<string>(
    centsToEuroInput(cod.defaultAmountCents),
  );
  const [err, setErr] = useState<string | null>(null);

  function handleCreate() {
    setErr(null);
    const w = Number.parseInt(weight, 10);
    if (!Number.isFinite(w) || w < 1 || w > 31500) {
      setErr("Gewicht in Gramm muss zwischen 1 und 31500 liegen.");
      return;
    }
    let codCents: number | null = null;
    if (cod.required) {
      const parsed = parseEuroToCents(codAmount);
      if (parsed == null || parsed <= 0) {
        setErr(
          "Nachnahme-Betrag fehlt. Bitte den offenen Bruttobetrag in EUR eintragen (z. B. 49,90).",
        );
        return;
      }
      if (parsed > 350000) {
        setErr("Nachnahme-Betrag überschreitet DHL-Limit von 3.500,00 EUR.");
        return;
      }
      codCents = parsed;
    }
    startTransition(async () => {
      const res = await createDhlLabelAction(orderId, w, codCents);
      if (res.ok) {
        window.open(res.labelUrl, "_blank", "noopener,noreferrer");
        router.refresh();
      } else {
        setErr(prettifyError(res.error));
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="dhl-weight"
            className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70"
          >
            Paketgewicht (Gramm)
          </label>
          <input
            id="dhl-weight"
            type="number"
            min={1}
            max={31500}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="mt-1.5 w-32 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-brand-ink shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
        </div>
        {cod.required ? (
          <div>
            <label
              htmlFor="dhl-cod-amount"
              className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy"
            >
              Nachnahme-Betrag (EUR)
            </label>
            <input
              id="dhl-cod-amount"
              type="text"
              inputMode="decimal"
              placeholder="49,90"
              value={codAmount}
              onChange={(e) => setCodAmount(e.target.value)}
              className="mt-1.5 w-32 rounded-md border border-brand-burgundy/40 bg-white px-3 py-2 font-mono text-sm text-brand-ink shadow-sm transition focus:border-brand-burgundy focus:outline-none focus:ring-2 focus:ring-brand-burgundy/20"
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-brand-burgundy px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-burgundy-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Erzeuge Etikett…" : "DHL-Etikett erstellen"}
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/60">
          Inland DE — DHL Paket (V01PAK)
        </span>
      </div>
      {err ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          {err}
        </div>
      ) : null}
    </div>
  );
}

function ExistingLabelPanel({
  orderId,
  shipment,
  defaultWeightG,
  cod,
}: {
  orderId: string;
  shipment: {
    shipment_no: string;
    label_url?: string;
    tracking_url: string;
    weight_g: number;
    sandbox: boolean;
  };
  defaultWeightG: number;
  cod: { required: boolean; defaultAmountCents: number | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirmRecreate, setConfirmRecreate] = useState(false);

  function handleRecreate() {
    if (!confirmRecreate) {
      setConfirmRecreate(true);
      return;
    }
    setErr(null);
    startTransition(async () => {
      // On recreate we don't expose a fresh COD input — reuse what Shopify
      // sent (if any). If it's a COD order without amount, the action will
      // return `cod_missing_amount` and the user can use the regular flow
      // via "Etikett neu erstellen" by deleting the existing shipment.
      const res = await createDhlLabelAction(
        orderId,
        defaultWeightG,
        cod.required ? cod.defaultAmountCents : null,
      );
      if (res.ok) {
        window.open(res.labelUrl, "_blank", "noopener,noreferrer");
        router.refresh();
      } else {
        setErr(prettifyError(res.error));
        setConfirmRecreate(false);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <div className="flex flex-wrap items-center gap-3">
          <div className="space-y-0.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em]">
              DHL Sendungsnummer
              {shipment.sandbox ? (
                <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[10px] text-amber-900">
                  SANDBOX
                </span>
              ) : null}
            </div>
            <div className="font-mono text-base font-bold">
              {shipment.shipment_no}
            </div>
            <div className="text-xs text-emerald-800/80">
              Gewicht: {shipment.weight_g} g
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {shipment.label_url ? (
          <a
            href={shipment.label_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-navy-soft"
          >
            Etikett-PDF öffnen
            <ExternalIcon />
          </a>
        ) : null}
        <a
          href={shipment.tracking_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-brand-navy/30 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand-navy hover:bg-brand-navy/5"
        >
          Tracking
          <ExternalIcon />
        </a>
        <button
          type="button"
          onClick={handleRecreate}
          disabled={pending}
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-burgundy underline-offset-4 hover:underline disabled:opacity-50"
        >
          {pending
            ? "Erzeuge…"
            : confirmRecreate
              ? "Wirklich neu? Nochmal klicken"
              : "Etikett neu erstellen"}
        </button>
      </div>
      {err ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          {err}
        </div>
      ) : null}
    </div>
  );
}

function prettifyError(code: string): string {
  if (code === "dhl_config:not_configured") {
    return "DHL ist noch nicht konfiguriert. Bitte in den Admin-Einstellungen Abrechnungsnummer + Absenderadresse pflegen.";
  }
  if (code === "dhl_config:billing_number_missing") {
    return "Abrechnungsnummer (EKP) fehlt in der DHL-Konfiguration.";
  }
  if (code === "dhl_config:credentials_missing") {
    return "Geschäftskundenportal-Username/Passwort fehlen in der DHL-Konfiguration.";
  }
  if (code === "dhl_config:client_credentials_missing") {
    return "DHL_API_KEY/SECRET fehlen in den ENV-Variablen.";
  }
  if (code.startsWith("address:")) {
    return `Lieferadresse unvollständig (${code.slice("address:".length)}).`;
  }
  if (code === "dhl_validation_failed") {
    return "DHL hat den Versandauftrag abgelehnt. Bitte Adresse / Gewicht prüfen (Details siehe Logs).";
  }
  if (code === "dhl_no_label_returned") {
    return "DHL hat zwar geantwortet, aber kein Etikett zurückgegeben.";
  }
  if (code.startsWith("dhl_services:")) {
    const sub = code.slice("dhl_services:".length);
    if (sub === "cod_missing_amount") {
      return "Versandmethode ist Nachnahme, aber kein offener Betrag hinterlegt. Betrag manuell eingeben oder Order neu synchronisieren.";
    }
    if (sub === "cod_missing_account_reference") {
      return "Nachnahme-Kontoreferenz fehlt — bitte in den Admin-Einstellungen unter DHL pflegen.";
    }
    if (sub === "cod_currency_not_eur") {
      return "Nachnahme ist nur in EUR möglich.";
    }
    return `DHL-Sonderleistung: ${sub}`;
  }
  if (code.startsWith("dhl_auth:")) {
    return `DHL-Authentifizierung fehlgeschlagen (${code.slice("dhl_auth:".length)}). Credentials prüfen.`;
  }
  if (code.startsWith("dhl_api:")) {
    return `DHL-API-Fehler (HTTP ${code.slice("dhl_api:".length)}).`;
  }
  return `Fehler: ${code}`;
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path d="M11 3a1 1 0 1 0 0 2h2.586L8.293 10.293a1 1 0 1 0 1.414 1.414L15 6.414V9a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z" />
      <path d="M5 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H5V7h3a1 1 0 0 0 0-2H5Z" />
    </svg>
  );
}
