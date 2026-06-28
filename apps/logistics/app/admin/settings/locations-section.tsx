"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createLocationAction,
  listLocationsAction,
  setDefaultLocationAction,
  syncLocationsAction,
} from "./location-actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

type LocationRow = {
  id: string;
  name: string;
  isPrimary: boolean;
  active: boolean;
  shopifyGid: string;
};

export function LocationsSection() {
  const [rows, setRows] = useState<LocationRow[] | null>(null);
  const [defaultLocationId, setDefaultLocationId] = useState<string | null>(
    null,
  );
  const [showForm, setShowForm] = useState(false);
  const [pending, startTransition] = useTransition();

  function reload() {
    listLocationsAction().then((res) => {
      if (res.ok) {
        setRows(res.rows);
        setDefaultLocationId(res.defaultLocationId);
      } else {
        dispatchAdminJobError({ title: "Standorte", message: res.error });
      }
    });
  }

  useEffect(() => {
    reload();
  }, []);

  function handleSync() {
    startTransition(async () => {
      const res = await syncLocationsAction();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Standorte",
          message: `${res.count} Standorte von Shopify synchronisiert.`,
        });
        reload();
      } else {
        dispatchAdminJobError({ title: "Standorte", message: res.error });
      }
    });
  }

  function handleSetDefault(locationId: string) {
    startTransition(async () => {
      const res = await setDefaultLocationAction(locationId);
      if (res.ok) {
        setDefaultLocationId(locationId);
        dispatchAdminJobSuccess({
          title: "Standorte",
          message: "Standard-Lagerstandort gespeichert.",
        });
      } else {
        dispatchAdminJobError({ title: "Standorte", message: res.error });
      }
    });
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createLocationAction({
        name: String(fd.get("name") ?? ""),
        address1: String(fd.get("address1") ?? ""),
        city: String(fd.get("city") ?? ""),
        zip: String(fd.get("zip") ?? ""),
        countryCode: String(fd.get("countryCode") ?? "DE"),
        phone: String(fd.get("phone") ?? "") || undefined,
      });
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Standorte",
          message: `Standort „${res.name}" angelegt.`,
        });
        setShowForm(false);
        reload();
      } else {
        dispatchAdminJobError({ title: "Standorte", message: res.error });
      }
    });
  }

  return (
    <>
      <section className="card p-6">
        <p className="eyebrow">Standorte</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          Shopify Locations
        </h2>
        <p className="mt-1 text-xs text-brand-navy/60">
          Bestand wird pro Standort geführt (<code>variant_location_stock</code>
          ). Chargen und Wareneingänge werden einem Standort zugeordnet. Push
          und Webhooks laufen pro Location.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSync}
            disabled={pending}
            className="btn-secondary text-sm"
          >
            {pending ? "…" : "Von Shopify syncen"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy"
          >
            {showForm ? "Abbrechen" : "+ Neuer Standort in Shopify"}
          </button>
        </div>

        {rows === null ? (
          <p className="mt-4 text-sm text-brand-navy/50">Lade…</p>
        ) : null}

        {rows && rows.length > 0 ? (
          <ul className="mt-4 divide-y divide-zinc-100 rounded-md border border-zinc-200">
            {rows.map((loc) => {
              const isDefault = defaultLocationId === loc.id;
              return (
                <li
                  key={loc.id}
                  className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <span className="font-semibold text-brand-navy">
                      {loc.name}
                    </span>
                    {!loc.active ? (
                      <span className="ml-2 text-xs text-brand-navy/50">
                        (inaktiv)
                      </span>
                    ) : null}
                    {loc.isPrimary ? (
                      <span className="ml-2 rounded bg-brand-cream px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-navy/70">
                        Shopify Primary
                      </span>
                    ) : null}
                    {isDefault ? (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                        Standard-Lager
                      </span>
                    ) : null}
                    <div className="mt-0.5 font-mono text-xs text-brand-navy/50">
                      {loc.id}
                    </div>
                  </div>
                  {loc.active ? (
                    <button
                      type="button"
                      disabled={pending || isDefault}
                      onClick={() => handleSetDefault(loc.id)}
                      className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 hover:text-brand-burgundy disabled:opacity-40"
                    >
                      Als Standard setzen
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : rows && rows.length === 0 ? (
          <p className="mt-4 text-sm text-brand-navy/60">
            Noch keine Standorte — zuerst von Shopify syncen oder neuen Standort
            anlegen.
          </p>
        ) : null}

        {showForm ? (
          <form onSubmit={handleCreate} className="mt-4 space-y-3">
            <Field label="Name" name="name" required />
            <Field label="Straße" name="address1" required />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="PLZ" name="zip" required />
              <Field label="Stadt" name="city" required />
              <Field label="Land (ISO)" name="countryCode" defaultValue="DE" />
            </div>
            <Field label="Telefon (optional)" name="phone" />
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "…" : "In Shopify anlegen"}
            </button>
          </form>
        ) : null}
      </section>
    </>
  );
}

function Field({
  label,
  name,
  required,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </span>
      <input
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
    </label>
  );
}
