"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveInventorySourceAction } from "./inventory-source-actions";
import type { InventorySource } from "@/server/firestore/schema";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export type InventorySourceFormValue = {
  inventory_source: InventorySource;
};

const OPTIONS: Array<{
  value: InventorySource;
  title: string;
  description: string;
}> = [
  {
    value: "APP",
    title: "Lager-App",
    description:
      "Wareneingänge, Chargen und Verpacken aktualisieren den Bestand hier. Änderungen werden automatisch nach Shopify übertragen. Manuelle Anpassungen in Shopify werden protokolliert.",
  },
  {
    value: "SHOPIFY",
    title: "Shopify",
    description:
      "Shopify führt die verkaufbare Menge. Änderungen in Shopify übernimmt die Lager-App automatisch — es wird kein Bestand zurückgeschrieben.",
  },
];

export function InventorySourceForm({
  current,
}: {
  current: InventorySourceFormValue;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<InventorySource>(
    current.inventory_source,
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveInventorySourceAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Bestandsführung",
          message: "Bestandsführung gespeichert.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "Bestandsführung",
          message: `${res.error}${
            res.details ? ` — ${JSON.stringify(res.details)}` : ""
          }`,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset className="space-y-3">
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-4 transition ${
              selected === opt.value
                ? "border-brand-burgundy/40 bg-brand-burgundy-soft/30"
                : "border-zinc-200 bg-zinc-50 hover:border-zinc-300"
            }`}
          >
            <input
              type="radio"
              name="inventory_source"
              value={opt.value}
              checked={selected === opt.value}
              onChange={() => setSelected(opt.value)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-semibold text-brand-navy">
                {opt.title}
              </span>
              <span className="mt-1 block text-xs text-brand-navy/70">
                {opt.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {pending ? "Speichern…" : "Speichern"}
        </button>
      </div>
    </form>
  );
}
