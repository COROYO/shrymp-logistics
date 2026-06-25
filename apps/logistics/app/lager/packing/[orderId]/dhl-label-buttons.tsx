"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("packing.dhl");

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
          {t("internationalButton")}
          <ExternalIcon />
        </a>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/60">
          {t("internationalNotice", { country: countryCode })}
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
  const t = useTranslations("packing.dhl");
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
      setErr(t("errors.weightRange"));
      return;
    }
    let codCents: number | null = null;
    if (cod.required) {
      const parsed = parseEuroToCents(codAmount);
      if (parsed == null || parsed <= 0) {
        setErr(t("errors.codMissing"));
        return;
      }
      if (parsed > 350000) {
        setErr(t("errors.codOverLimit"));
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
        setErr(prettifyError(res.error, t));
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
            {t("weightLabel")}
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
              {t("codAmountLabel")}
            </label>
            <input
              id="dhl-cod-amount"
              type="text"
              inputMode="decimal"
              placeholder={t("codAmountPlaceholder")}
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
          {pending ? t("creating") : t("createButton")}
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/60">
          {t("domestic")}
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
  const t = useTranslations("packing.dhl");
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
        setErr(prettifyError(res.error, t));
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
              {t("existingNumber")}
              {shipment.sandbox ? (
                <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[10px] text-amber-900">
                  {t("existingSandbox")}
                </span>
              ) : null}
            </div>
            <div className="font-mono text-base font-bold">
              {shipment.shipment_no}
            </div>
            <div className="text-xs text-emerald-800/80">
              {t("existingWeight", { weight: shipment.weight_g })}
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
            {t("openPdf")}
            <ExternalIcon />
          </a>
        ) : null}
        <a
          href={shipment.tracking_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-brand-navy/30 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand-navy hover:bg-brand-navy/5"
        >
          {t("tracking")}
          <ExternalIcon />
        </a>
        <button
          type="button"
          onClick={handleRecreate}
          disabled={pending}
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-burgundy underline-offset-4 hover:underline disabled:opacity-50"
        >
          {pending
            ? t("recreating")
            : confirmRecreate
              ? t("recreateConfirm")
              : t("recreate")}
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

type DhlT = (key: string, values?: Record<string, string | number>) => string;

function prettifyError(code: string, t: DhlT): string {
  if (code === "dhl_config:not_configured") return t("errors.configNotConfigured");
  if (code === "dhl_config:billing_number_missing")
    return t("errors.configBillingMissing");
  if (code === "dhl_config:credentials_missing")
    return t("errors.configCredentialsMissing");
  if (code === "dhl_config:client_credentials_missing")
    return t("errors.configClientCredsMissing");
  if (code.startsWith("address:"))
    return t("errors.address", { field: code.slice("address:".length) });
  if (code === "dhl_validation_failed") return t("errors.validationFailed");
  if (code === "dhl_no_label_returned") return t("errors.noLabel");
  if (code.startsWith("dhl_services:")) {
    const sub = code.slice("dhl_services:".length);
    if (sub === "cod_missing_amount") return t("errors.codMissingAmount");
    if (sub === "cod_missing_account_reference")
      return t("errors.codMissingAccountRef");
    if (sub === "cod_currency_not_eur") return t("errors.codCurrency");
    return t("errors.servicesGeneric", { sub });
  }
  if (code.startsWith("dhl_auth:"))
    return t("errors.auth", { status: code.slice("dhl_auth:".length) });
  if (code.startsWith("dhl_api:"))
    return t("errors.api", { status: code.slice("dhl_api:".length) });
  return t("errors.generic", { code });
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
