"use client";
import { useState, useTransition } from "react";
import { triggerProductSyncAction } from "./actions";

export function ProductSyncButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await triggerProductSyncAction();
      if (res.ok) {
        setMsg(
          `Sync OK · ${res.productCount} Produkte · ${res.variantCount} Varianten · Location ${res.locationGid}`,
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
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Synchronisiere…" : "Jetzt synchronisieren"}
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
