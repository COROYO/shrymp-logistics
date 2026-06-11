"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLagerConfigAction } from "./lager-config-actions";
import { DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY } from "@/lib/lager/defaults";

export type LagerConfigFormValue = {
  batch_min_days_before_expiry: number;
};

export function LagerConfigForm({
  current,
}: {
  current: LagerConfigFormValue;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveLagerConfigAction(fd);
      if (res.ok) {
        setMsg({ ok: true, text: "Lager-Einstellungen gespeichert." });
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
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="max-w-xs">
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
          defaultValue={current.batch_min_days_before_expiry}
          className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-mono"
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
        {msg ? (
          <span
            className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}
          >
            {msg.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
