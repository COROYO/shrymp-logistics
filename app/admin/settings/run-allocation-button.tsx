"use client";
import { useState, useTransition } from "react";
import { runAllocationAction } from "./actions";

export function RunAllocationButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await runAllocationAction();
      if (res.ok) {
        setMsg(
          `Run ${res.runId.slice(0, 8)}… · SHIP=${res.shipCount} · STOP=${res.stopCount}`,
        );
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
      >
        {pending ? "Läuft…" : "Allocation manuell starten"}
      </button>
      {msg ? (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Fehler: {err}
        </div>
      ) : null}
    </div>
  );
}
