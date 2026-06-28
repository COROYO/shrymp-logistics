"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLagerConfigAction } from "./lager-config-actions";
import { DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY } from "@/lib/lager/defaults";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export type LagerConfigFormValue = {
  batches_enabled: boolean;
  batch_min_days_before_expiry: number;
};

export function LagerConfigForm({
  current,
}: {
  current: LagerConfigFormValue;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [batchesEnabled, setBatchesEnabled] = useState(current.batches_enabled);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveLagerConfigAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Lager",
          message: "Lager-Einstellungen gespeichert.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "Lager",
          message: `${res.error}${
            res.details ? ` — ${JSON.stringify(res.details)}` : ""
          }`,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="batches_enabled"
            value="1"
            checked={batchesEnabled}
            onChange={(e) => setBatchesEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300"
          />
          <span>
            <span className="block text-sm font-semibold text-brand-navy">
              Chargen-Tracking aktiv
            </span>
            <span className="mt-1 block text-xs text-brand-navy/70">
              Wenn aktiv, werden beim Lieferschein-Druck Chargen per FEFO
              zugeordnet und die MHD-Sperre greift — Allocation nutzt dann den
              Chargen-Pool. Wenn deaktiviert, arbeitet Allocation und Versand
              nur mit Varianten-Bestand (<code>on_hand − reserved</code>), ohne
              Chargen auf dem Lieferschein.
            </span>
          </span>
        </label>
      </div>

      <div className={`max-w-xs ${batchesEnabled ? "" : "opacity-50"}`}>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
          Mindest-Restlaufzeit (Tage)
        </label>
        <p className="mt-1 text-xs text-brand-navy/70">
          Chargen mit einem MHD in dieser Anzahl Kalendertagen oder weniger
          werden bei der Lieferschein-Zuordnung übersprungen. Standard:{" "}
          {DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY} Tage.
        </p>
        <input
          type="number"
          name="batch_min_days_before_expiry"
          min={0}
          max={365}
          step={1}
          required
          disabled={!batchesEnabled}
          defaultValue={current.batch_min_days_before_expiry}
          className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-mono disabled:bg-zinc-100"
        />
      </div>

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
