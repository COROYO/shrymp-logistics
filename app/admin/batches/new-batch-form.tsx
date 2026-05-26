"use client";
import { useActionState, useEffect, useRef } from "react";
import { receiveBatchAction, type ReceiveBatchActionState } from "./actions";

export type VariantOption = {
  id: string;
  label: string;
};

export function NewBatchForm({ variants }: { variants: VariantOption[] }) {
  const [state, formAction, pending] = useActionState<
    ReceiveBatchActionState,
    FormData
  >(receiveBatchAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && !pending) formRef.current?.reset();
  }, [state, pending]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Variante</label>
        <select
          name="variantId"
          required
          defaultValue=""
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Bitte wählen…
          </option>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-sm font-medium">Charge</label>
          <input
            type="text"
            name="chargeNumber"
            required
            placeholder="z. B. 0001"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">MHD</label>
          <input
            type="date"
            name="expiryDate"
            required
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Menge (Stk.)</label>
          <input
            type="number"
            name="qty"
            min={1}
            step={1}
            required
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">Notiz (optional)</label>
        <input
          type="text"
          name="note"
          maxLength={500}
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Speichern…" : "Charge erfassen"}
        </button>
        {state?.ok ? (
          <span className="text-sm text-emerald-700">
            Charge {state.batchId.slice(0, 8)}… angelegt. Neuer Bestand:{" "}
            {state.newOnHandTotal}
          </span>
        ) : null}
        {state && !state.ok ? (
          <span className="text-sm text-red-700">Fehler: {state.error}</span>
        ) : null}
      </div>
    </form>
  );
}
