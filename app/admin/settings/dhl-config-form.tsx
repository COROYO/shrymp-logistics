"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDhlConfigAction } from "./dhl-config-actions";

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
  gkp_username: string | null;
  gkp_password_set: boolean;
  sandbox: boolean;
};

export function DhlConfigForm({
  current,
}: {
  current: DhlConfigFormValue | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveDhlConfigAction(fd);
      if (res.ok) {
        setMsg({ ok: true, text: "DHL-Konfiguration gespeichert." });
        router.refresh();
      } else {
        setMsg({
          ok: false,
          text: `Fehler: ${res.error}${
            res.details ? ` — ${JSON.stringify(res.details)}` : ""
          }`,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Abrechnungsnummer (EKP, 14-stellig)"
          name="billing_number"
          defaultValue={current?.billing_number ?? ""}
          required
          mono
          placeholder="33333333330102"
        />
        <Field
          label="Profile"
          name="profile"
          defaultValue={current?.profile ?? "STANDARD_GRUPPENPROFIL"}
          mono
        />
      </div>

      <div>
        <p className="eyebrow">Geschäftskundenportal-Zugang (OAuth2)</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <Field
            label="GKP Username"
            name="gkp_username"
            defaultValue={current?.gkp_username ?? ""}
          />
          <Field
            label={
              current?.gkp_password_set
                ? "GKP Passwort (leer = unverändert)"
                : "GKP Passwort"
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
          Sandbox-Endpunkt verwenden (api-sandbox.dhl.com)
        </label>
      </div>

      <div>
        <p className="eyebrow">Absenderadresse (Shipper)</p>
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
            label="Land (ISO-3 alpha-3)"
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
            label="Gewicht (g)"
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
          Maße sind optional — DHL akzeptiert Versandaufträge auch ohne. Wenn
          angegeben, müssen alle drei gesetzt sein.
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
        {msg ? (
          <span
            className={
              msg.ok
                ? "text-xs font-semibold text-emerald-700"
                : "text-xs font-semibold text-brand-burgundy-dark"
            }
          >
            {msg.text}
          </span>
        ) : null}
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
