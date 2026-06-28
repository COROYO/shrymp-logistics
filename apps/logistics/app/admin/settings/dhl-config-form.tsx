"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDhlConfigAction } from "./dhl-config-actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

/**
 * Serializable subset of `DhlConfig` for client-side editing. The Firestore
 * Timestamp on the source doc carries a function (`toMillis`) which cannot
 * cross the Server→Client boundary, so we project to a plain shape here.
 */
export type DhlConfigFormValue = {
  billing_number: string;
  profile: string;
  shipper: {
    name1: string;
    name2: string | null;
    addressStreet: string;
    addressHouse: string | null;
    postalCode: string;
    city: string;
    country: string;
    email: string | null;
    phone: string | null;
  };
  default_weight_g: number;
  default_dimensions_mm?: {
    length: number;
    width: number;
    height: number;
  };
  api_key: string | null;
  api_secret_set: boolean;
  gkp_username: string | null;
  gkp_password_set: boolean;
  cod_account_reference: string | null;
  sandbox: boolean;
};

export function DhlConfigForm({
  current,
}: {
  current: DhlConfigFormValue | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveDhlConfigAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "DHL",
          message: "DHL-Einstellungen gespeichert.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "DHL",
          message: `${res.error}${
            res.details ? ` — ${JSON.stringify(res.details)}` : ""
          }`,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input
        type="hidden"
        name="profile"
        value={current?.profile ?? "STANDARD_GRUPPENPROFIL"}
      />

      <div>
        <Field
          label="Abrechnungsnummer (14-stellig)"
          name="billing_number"
          defaultValue={current?.billing_number ?? ""}
          required
          mono
          placeholder="33333333330102"
        />
        <p className="mt-1 text-[11px] text-brand-navy/60">
          Findest du im DHL Geschäftskundenportal unter deinen
          Versandeinstellungen.
        </p>
      </div>

      <div>
        <p className="eyebrow">DHL App-Zugang</p>
        <p className="mt-1 text-xs text-brand-navy/60">
          Zugangsdaten aus dem DHL Entwicklerportal — nicht dein
          Portal-Passwort.
        </p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <Field
            label="App-ID"
            name="api_key"
            defaultValue={current?.api_key ?? ""}
            mono
          />
          <Field
            label={
              current?.api_secret_set
                ? "App-Geheimnis (leer = unverändert)"
                : "App-Geheimnis"
            }
            name="api_secret"
            type="password"
            defaultValue=""
            placeholder={
              current?.api_secret_set ? "•••••••• gespeichert" : ""
            }
          />
        </div>
      </div>

      <div>
        <p className="eyebrow">Geschäftskundenportal</p>
        <p className="mt-1 text-xs text-brand-navy/60">
          Dein normaler Login für{" "}
          <strong>geschaeftskunden.dhl.de</strong>.
        </p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <Field
            label="Benutzername"
            name="gkp_username"
            defaultValue={current?.gkp_username ?? ""}
          />
          <Field
            label={
              current?.gkp_password_set
                ? "Passwort (leer = unverändert)"
                : "Passwort"
            }
            name="gkp_password"
            type="password"
            defaultValue=""
            placeholder={
              current?.gkp_password_set ? "•••••••• gespeichert" : ""
            }
          />
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-xs text-brand-navy/70">
          <input
            type="checkbox"
            name="sandbox"
            defaultChecked={current?.sandbox ?? true}
          />
          Testmodus (für erste Einrichtung und Probeläufe)
        </label>
      </div>

      <div>
        <p className="eyebrow">Nachnahme</p>
        <p className="mt-1 text-xs text-brand-navy/60">
          Kontoreferenz aus dem DHL Geschäftskundenportal (
          <strong>Versenden → Einstellungen → Nachnahme</strong>). Wird
          automatisch genutzt, wenn die Shopify-Versandmethode Nachnahme
          enthält (z.&nbsp;B. &quot;DHL Paket Nachnahme&quot;).
        </p>
        <div className="mt-2">
          <Field
            label="Kontoreferenz"
            name="cod_account_reference"
            defaultValue={current?.cod_account_reference ?? ""}
            mono
            placeholder="Referenz aus dem Geschäftskundenportal"
          />
        </div>
      </div>

      <div>
        <p className="eyebrow">Absenderadresse</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <Field
            label="Firmenname"
            name="shipper_name1"
            defaultValue={current?.shipper.name1 ?? ""}
            required
          />
          <Field
            label="Zusatz (optional)"
            name="shipper_name2"
            defaultValue={current?.shipper.name2 ?? ""}
          />
          <Field
            label="Straße"
            name="shipper_addressStreet"
            defaultValue={current?.shipper.addressStreet ?? ""}
            required
          />
          <Field
            label="Hausnummer (optional)"
            name="shipper_addressHouse"
            defaultValue={current?.shipper.addressHouse ?? ""}
          />
          <Field
            label="PLZ"
            name="shipper_postalCode"
            defaultValue={current?.shipper.postalCode ?? ""}
            required
            mono
          />
          <Field
            label="Stadt"
            name="shipper_city"
            defaultValue={current?.shipper.city ?? ""}
            required
          />
          <Field
            label="Land"
            name="shipper_country"
            defaultValue={current?.shipper.country ?? "DEU"}
            required
            mono
            placeholder="DEU"
          />
          <Field
            label="E-Mail (optional)"
            name="shipper_email"
            type="email"
            defaultValue={current?.shipper.email ?? ""}
          />
          <Field
            label="Telefon (optional)"
            name="shipper_phone"
            defaultValue={current?.shipper.phone ?? ""}
          />
        </div>
      </div>

      <div>
        <p className="eyebrow">Standard-Paket</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-4">
          <Field
            label="Gewicht (Gramm)"
            name="default_weight_g"
            type="number"
            defaultValue={String(current?.default_weight_g ?? 1000)}
            mono
            required
          />
          <Field
            label="Länge (mm)"
            name="dim_length"
            type="number"
            defaultValue={
              current?.default_dimensions_mm?.length
                ? String(current.default_dimensions_mm.length)
                : ""
            }
            mono
          />
          <Field
            label="Breite (mm)"
            name="dim_width"
            type="number"
            defaultValue={
              current?.default_dimensions_mm?.width
                ? String(current.default_dimensions_mm.width)
                : ""
            }
            mono
          />
          <Field
            label="Höhe (mm)"
            name="dim_height"
            type="number"
            defaultValue={
              current?.default_dimensions_mm?.height
                ? String(current.default_dimensions_mm.height)
                : ""
            }
            mono
          />
        </div>
        <p className="mt-1 text-[11px] text-brand-navy/60">
          Maße sind optional. Wenn angegeben, müssen alle drei gesetzt sein.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-navy-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Speichere…" : "Speichern"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  mono = false,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        className={`mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-brand-ink shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}
