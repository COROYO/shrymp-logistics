"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelPickingAction,
  startPickingAction,
} from "../actions";

export function StartPickingButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    setErr(null);
    startTransition(async () => {
      const res = await startPickingAction(orderId);
      if (res.ok) {
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "…" : "Picken starten"}
      </button>
      {err ? (
        <p className="mt-2 text-xs text-red-700">Fehler: {err}</p>
      ) : null}
    </div>
  );
}

export function CancelPickingButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    if (!confirm("Picking wirklich abbrechen? Die Order geht zurück in die Queue."))
      return;
    setErr(null);
    startTransition(async () => {
      const res = await cancelPickingAction(orderId);
      if (res.ok) {
        router.push("/lager/picking");
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {pending ? "…" : "Picken abbrechen"}
      </button>
      {err ? (
        <p className="mt-2 text-xs text-red-700">Fehler: {err}</p>
      ) : null}
    </div>
  );
}
