"use client";
import { useState, useTransition } from "react";
import Image from "next/image";
import {
  archiveBatchAction,
  editBatchAction,
  receiveBatchAction,
  type ReceiveBatchActionState,
} from "./actions";
import type { BatchRow, VariantRow } from "./product-accordion";

export function VariantBatchPanel({
  variant,
  priceLabel,
}: {
  variant: VariantRow;
  priceLabel: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-md border border-zinc-200 bg-white">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-zinc-200">
        <div className="flex-shrink-0 h-10 w-10 rounded bg-zinc-100 overflow-hidden">
          {variant.imageUrl ? (
            <Image
              src={variant.imageUrl}
              alt={variant.title}
              width={40}
              height={40}
              className="h-10 w-10 object-cover"
              unoptimized
            />
          ) : (
            <div className="h-10 w-10 grid place-items-center text-xs text-zinc-400">
              —
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{variant.title}</div>
          <div className="text-xs text-zinc-500">
            {variant.sku ? <>SKU {variant.sku} · </> : null}
            {priceLabel}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs text-right">
          <Cell label="On Hand" value={variant.onHand} />
          <Cell label="Reserv." value={variant.reserved} />
          <Cell
            label="Avail."
            value={variant.available}
            tone={variant.available <= 0 ? "warn" : undefined}
          />
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-4 py-1.5">Charge</th>
            <th className="px-4 py-1.5">MHD</th>
            <th className="px-4 py-1.5 text-right">Rest</th>
            <th className="px-4 py-1.5 text-right">Initial</th>
            <th className="px-4 py-1.5">Notiz</th>
            <th className="px-4 py-1.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {variant.batches.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-3 text-xs text-zinc-500">
                Noch keine aktive Charge.
              </td>
            </tr>
          ) : (
            variant.batches.map((b) =>
              editingId === b.id ? (
                <EditBatchRow
                  key={b.id}
                  batch={b}
                  onClose={() => setEditingId(null)}
                />
              ) : (
                <BatchDisplayRow
                  key={b.id}
                  batch={b}
                  onEdit={() => setEditingId(b.id)}
                />
              ),
            )
          )}
        </tbody>
      </table>

      <div className="border-t border-zinc-200 p-3">
        {adding ? (
          <NewBatchInlineForm
            variantId={variant.id}
            onClose={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-sm text-zinc-900 hover:underline"
          >
            + Neue Charge
          </button>
        )}
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={`text-sm font-semibold ${
          tone === "warn" ? "text-red-700" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function BatchDisplayRow({
  batch,
  onEdit,
}: {
  batch: BatchRow;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleArchive() {
    if (
      !confirm(
        `Charge ${batch.chargeNumber} archivieren? Restmenge ${batch.remainingQty} wird ausgebucht.`,
      )
    )
      return;
    setErr(null);
    startTransition(async () => {
      const res = await archiveBatchAction(batch.id);
      if (!res.ok) setErr(res.error);
    });
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-2 font-mono">{batch.chargeNumber}</td>
      <td className="px-4 py-2 font-mono">{batch.expiryDateIso || "—"}</td>
      <td className="px-4 py-2 text-right font-semibold">
        {batch.remainingQty}
      </td>
      <td className="px-4 py-2 text-right text-zinc-500">{batch.initialQty}</td>
      <td className="px-4 py-2 text-xs text-zinc-500">{batch.notes ?? ""}</td>
      <td className="px-4 py-2 text-right">
        <div className="inline-flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-zinc-700 hover:underline"
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={pending}
            className="text-xs text-red-700 hover:underline disabled:opacity-50"
          >
            {pending ? "…" : "Archivieren"}
          </button>
        </div>
        {err ? (
          <div className="text-[10px] text-red-700 mt-1">{err}</div>
        ) : null}
      </td>
    </tr>
  );
}

function EditBatchRow({
  batch,
  onClose,
}: {
  batch: BatchRow;
  onClose: () => void;
}) {
  const [chargeNumber, setChargeNumber] = useState(batch.chargeNumber);
  const [expiry, setExpiry] = useState(batch.expiryDateIso);
  const [remaining, setRemaining] = useState(String(batch.remainingQty));
  const [notes, setNotes] = useState(batch.notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setErr(null);
    const remainingNum = remaining === "" ? undefined : Number(remaining);
    startTransition(async () => {
      const res = await editBatchAction({
        batchId: batch.id,
        chargeNumber:
          chargeNumber !== batch.chargeNumber ? chargeNumber : undefined,
        expiryDate: expiry !== batch.expiryDateIso ? expiry : undefined,
        remainingQty:
          remainingNum !== undefined && remainingNum !== batch.remainingQty
            ? remainingNum
            : undefined,
        notes: notes !== (batch.notes ?? "") ? notes : undefined,
      });
      if (res.ok) onClose();
      else setErr(res.error);
    });
  }

  return (
    <tr className="bg-amber-50/60 align-top">
      <td className="px-4 py-2">
        <input
          type="text"
          value={chargeNumber}
          onChange={(e) => setChargeNumber(e.target.value)}
          className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm font-mono"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="w-36 rounded border border-zinc-300 px-2 py-1 text-sm font-mono"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          min={0}
          step={1}
          value={remaining}
          onChange={(e) => setRemaining(e.target.value)}
          className="w-20 rounded border border-zinc-300 px-2 py-1 text-sm text-right"
        />
      </td>
      <td className="px-4 py-2 text-right text-zinc-500">{batch.initialQty}</td>
      <td className="px-4 py-2">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <div className="inline-flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {pending ? "…" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-xs text-zinc-700 hover:underline"
          >
            Abbrechen
          </button>
        </div>
        {err ? (
          <div className="text-[10px] text-red-700 mt-1 max-w-xs">{err}</div>
        ) : null}
      </td>
    </tr>
  );
}

function NewBatchInlineForm({
  variantId,
  onClose,
}: {
  variantId: string;
  onClose: () => void;
}) {
  const [chargeNumber, setChargeNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setErr(null);
    const fd = new FormData();
    fd.set("variantId", variantId);
    fd.set("chargeNumber", chargeNumber);
    fd.set("expiryDate", expiry);
    fd.set("qty", qty);
    fd.set("note", notes);
    startTransition(async () => {
      const res: ReceiveBatchActionState = await receiveBatchAction(null, fd);
      if (res?.ok) onClose();
      else if (res) setErr(res.error);
    });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_2fr_auto] gap-2 items-start">
      <input
        type="text"
        placeholder="Charge-Nr"
        value={chargeNumber}
        onChange={(e) => setChargeNumber(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm font-mono"
      />
      <input
        type="date"
        value={expiry}
        onChange={(e) => setExpiry(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm font-mono"
      />
      <input
        type="number"
        placeholder="Menge"
        min={1}
        step={1}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm text-right"
      />
      <input
        type="text"
        placeholder="Notiz (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={500}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2 sm:flex-col sm:items-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !chargeNumber || !expiry || !qty}
          className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "…" : "Speichern"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="text-xs text-zinc-700 hover:underline"
        >
          Abbrechen
        </button>
      </div>
      {err ? (
        <div className="sm:col-span-5 text-xs text-red-700">{err}</div>
      ) : null}
    </div>
  );
}
