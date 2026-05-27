"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmPackingAction } from "../actions";

export function ConfirmPackingForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [carrier, setCarrier] = useState("DHL");
  const [number, setNumber] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setErr(null);
    const tracking =
      number.trim().length > 0
        ? { carrier: carrier.trim() || undefined, number: number.trim() }
        : null;
    startTransition(async () => {
      const res = await confirmPackingAction(orderId, tracking);
      if (res.ok) {
        router.push("/lager/picking");
        router.refresh();
      } else {
        setErr(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="carrier" className="block text-xs font-medium">
            Versanddienst (optional)
          </label>
          <input
            id="carrier"
            type="text"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            maxLength={80}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="number" className="block text-xs font-medium">
            Tracking-Nr (optional)
          </label>
          <input
            id="number"
            type="text"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            maxLength={80}
            placeholder="Leer lassen wenn noch keine Nr"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`w-full rounded-md px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50 ${
          confirming ? "bg-emerald-700 hover:bg-emerald-800" : "bg-zinc-900 hover:bg-zinc-800"
        }`}
      >
        {pending
          ? "Buche…"
          : confirming
            ? "Sicher? Nochmal klicken zum Bestätigen"
            : "Verpackt + versendet"}
      </button>
      {err ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Fehler: {err}
        </div>
      ) : null}
    </div>
  );
}
