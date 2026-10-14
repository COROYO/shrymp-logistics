"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  SHOPIFY_FULFILLMENT_STATUSES,
  SHOPIFY_FULFILLMENT_STATUS_LABELS,
  SHOPIFY_PAYMENT_STATUSES,
  SHOPIFY_PAYMENT_STATUS_LABELS,
} from "@/lib/orders/shopify-status";
import { saveShipStatusesAction } from "./ship-status-actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function ShipStatusForm({
  current,
}: {
  current: {
    ship_payment_statuses: string[];
    ship_fulfillment_statuses: string[];
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [payment, setPayment] = useState(
    () => new Set(current.ship_payment_statuses),
  );
  const [fulfillment, setFulfillment] = useState(
    () => new Set(current.ship_fulfillment_statuses),
  );

  function toggle(set: Set<string>, value: string, next: (s: Set<string>) => void) {
    const copy = new Set(set);
    if (copy.has(value)) copy.delete(value);
    else copy.add(value);
    next(copy);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    for (const status of payment) fd.append("ship_payment_statuses", status);
    for (const status of fulfillment) {
      fd.append("ship_fulfillment_statuses", status);
    }
    startTransition(async () => {
      const res = await saveShipStatusesAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Versandbereit",
          message: "Stati gespeichert. Offene Aufträge werden neu geprüft.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "Versandbereit",
          message: res.error,
        });
      }
    });
  }

  const noneSelected = payment.size === 0 || fulfillment.size === 0;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <StatusGroup
        legend="Zahlung"
        options={SHOPIFY_PAYMENT_STATUSES}
        labels={SHOPIFY_PAYMENT_STATUS_LABELS}
        selected={payment}
        onToggle={(value) => toggle(payment, value, setPayment)}
      />
      <StatusGroup
        legend="Fulfillment"
        options={SHOPIFY_FULFILLMENT_STATUSES}
        labels={SHOPIFY_FULFILLMENT_STATUS_LABELS}
        selected={fulfillment}
        onToggle={(value) => toggle(fulfillment, value, setFulfillment)}
      />
      {noneSelected ? (
        <p className="text-xs text-brand-burgundy">
          Ohne Haken in einer Gruppe wird keine Bestellung auf SHIP gesetzt.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="btn-primary text-sm disabled:opacity-50"
      >
        {pending ? "Speichern…" : "Speichern"}
      </button>
    </form>
  );
}

function StatusGroup<T extends string>({
  legend,
  options,
  labels,
  selected,
  onToggle,
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: Set<string>;
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {legend}
      </legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((status) => (
          <label
            key={status}
            className="flex items-start gap-2 text-sm text-brand-navy"
          >
            <input
              type="checkbox"
              value={status}
              checked={selected.has(status)}
              onChange={() => onToggle(status)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-burgundy"
            />
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span>{labels[status]}</span>
              <span className="font-mono text-[10px] text-brand-navy/40">
                {status}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
