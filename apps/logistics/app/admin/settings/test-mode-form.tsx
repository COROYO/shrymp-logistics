"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTestModeAction } from "./test-mode-actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function TestModeForm({ current }: { current: { test_mode: boolean } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(current.test_mode);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveTestModeAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Testmodus",
          message: enabled
            ? "Testmodus aktiv — keine Shopify-Schreibzugriffe."
            : "Testmodus deaktiviert — Änderungen werden zu Shopify gepusht.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "Testmodus",
          message: res.error,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-4">
        <input
          type="checkbox"
          name="test_mode"
          value="1"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300"
        />
        <span>
          <span className="block text-sm font-semibold text-brand-navy">
            Testmodus aktiv
          </span>
          <span className="mt-1 block text-xs text-brand-navy/70">
            Wenn aktiv, werden keine Daten zu Shopify geschrieben (Tags,
            Bestände, Fulfillments, Katalog). Geplante Änderungen erscheinen im
            Protokoll unten. Standardmäßig aktiv für sicheres Testen.
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
