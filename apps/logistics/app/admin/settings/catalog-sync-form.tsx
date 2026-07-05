"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCatalogSyncAction } from "./catalog-sync-actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function CatalogSyncForm({
  current,
}: {
  current: { catalog_sync_to_shopify: boolean };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(current.catalog_sync_to_shopify);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveCatalogSyncAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Katalog",
          message: "Katalog-Sync-Einstellung gespeichert.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "Katalog",
          message: res.error,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-4">
        <input
          type="checkbox"
          name="catalog_sync_to_shopify"
          value="1"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300"
        />
        <span>
          <span className="block text-sm font-semibold text-brand-navy">
            Produktänderungen zu Shopify synchronisieren
          </span>
          <span className="mt-1 block text-xs text-brand-navy/70">
            Standard für den Produkt-Editor. Einzelne Speichervorgänge können
            den Sync pro Vorgang überschreiben.
          </span>
        </span>
      </label>
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
