"use client";
import { useState, useTransition } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("batches.panel");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-4 border-b border-zinc-200 px-4 py-3">
        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-brand-cream ring-1 ring-zinc-200">
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
            <div className="grid h-10 w-10 place-items-center text-xs text-brand-navy/40">
              —
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-brand-navy">
            {variant.title}
          </div>
          <div className="text-xs text-brand-navy/60">
            {variant.sku ? (
              <>
                {t("skuLabel")} {variant.sku} ·{" "}
              </>
            ) : null}
            {priceLabel}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-right">
          <Cell label={t("onHandShort")} value={variant.onHand} />
          <Cell label={t("reservedShort")} value={variant.reserved} />
          <Cell
            label={t("availShort")}
            value={variant.available}
            tone={variant.available <= 0 ? "warn" : undefined}
          />
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-brand-cream text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70">
          <tr>
            <th className="px-4 py-2">{t("charge")}</th>
            <th className="px-4 py-2">{t("expiry")}</th>
            <th className="px-4 py-2 text-right">{t("remaining")}</th>
            <th className="px-4 py-2 text-right">{t("sold")}</th>
            <th className="px-4 py-2 text-right">{t("initial")}</th>
            <th className="px-4 py-2">{t("note")}</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {variant.batches.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-3 text-xs text-brand-navy/60"
              >
                {t("noActiveBatch")}
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
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy transition hover:text-brand-burgundy-dark"
          >
            {t("newBatch")}
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
        {label}
      </div>
      <div
        className={`text-sm font-bold tabular-nums ${
          tone === "warn" ? "text-brand-burgundy" : "text-brand-navy"
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
  const t = useTranslations("batches.panel");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleArchive() {
    if (
      !confirm(
        t("archiveConfirm", {
          charge: batch.chargeNumber,
          qty: batch.remainingQty,
        }),
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
    <tr className="align-top transition hover:bg-brand-navy-50">
      <td className="px-4 py-2.5 font-mono font-semibold text-brand-navy">
        {batch.chargeNumber}
      </td>
      <td className="px-4 py-2.5 font-mono text-brand-navy/80">
        {batch.expiryDateIso || "—"}
      </td>
      <td className="px-4 py-2.5 text-right text-base font-bold text-brand-navy">
        {batch.remainingQty}
      </td>
      <td className="px-4 py-2.5 text-right text-emerald-700">
        {batch.soldQty > 0 ? batch.soldQty : "—"}
      </td>
      <td className="px-4 py-2.5 text-right text-brand-navy/50">
        {batch.initialQty}
      </td>
      <td className="px-4 py-2.5 text-xs text-brand-navy/70">
        {batch.notes ?? ""}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="inline-flex gap-3 text-[11px] font-semibold uppercase tracking-[0.1em]">
          <button
            type="button"
            onClick={onEdit}
            className="text-brand-navy/70 transition hover:text-brand-burgundy"
          >
            {t("edit")}
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={pending}
            className="text-brand-burgundy transition hover:text-brand-burgundy-dark disabled:opacity-50"
          >
            {pending ? "…" : t("archive")}
          </button>
        </div>
        {err ? (
          <div className="mt-1 text-[10px] font-semibold text-brand-burgundy">
            {err}
          </div>
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
  const t = useTranslations("batches.panel");
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

  const inlineInput =
    "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

  return (
    <tr className="bg-amber-50/60 align-top">
      <td className="px-4 py-2">
        <input
          type="text"
          value={chargeNumber}
          onChange={(e) => setChargeNumber(e.target.value)}
          className={`${inlineInput} w-24 font-mono`}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className={`${inlineInput} w-36 font-mono`}
        />
      </td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          min={0}
          step={1}
          value={remaining}
          onChange={(e) => setRemaining(e.target.value)}
          className={`${inlineInput} w-20 text-right`}
        />
      </td>
      <td className="px-4 py-2 text-right text-emerald-700/70">
        {batch.soldQty > 0 ? batch.soldQty : "—"}
      </td>
      <td className="px-4 py-2 text-right text-brand-navy/50">
        {batch.initialQty}
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          className={`${inlineInput} w-full`}
        />
      </td>
      <td className="px-4 py-2 text-right">
        <div className="inline-flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.1em]">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded-md bg-brand-burgundy px-3 py-1.5 text-white shadow-sm transition hover:bg-brand-burgundy-dark disabled:opacity-50"
          >
            {pending ? "…" : t("save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-brand-navy/70 transition hover:text-brand-burgundy"
          >
            {t("cancel")}
          </button>
        </div>
        {err ? (
          <div className="mt-1 max-w-xs text-[10px] font-semibold text-brand-burgundy">
            {err}
          </div>
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
  const t = useTranslations("batches.panel");
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

  const input =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

  return (
    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[1fr_1fr_1fr_2fr_auto]">
      <input
        type="text"
        placeholder={t("chargeNoPlaceholder")}
        value={chargeNumber}
        onChange={(e) => setChargeNumber(e.target.value)}
        className={`${input} font-mono`}
      />
      <input
        type="date"
        value={expiry}
        onChange={(e) => setExpiry(e.target.value)}
        className={`${input} font-mono`}
      />
      <input
        type="number"
        placeholder={t("qtyPlaceholder")}
        min={1}
        step={1}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className={`${input} text-right`}
      />
      <input
        type="text"
        placeholder={t("notePlaceholder")}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={500}
        className={input}
      />
      <div className="flex items-center gap-3 sm:flex-col sm:items-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !chargeNumber || !expiry || !qty}
          className="btn-primary !px-4 !py-2"
        >
          {pending ? "…" : t("save")}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 transition hover:text-brand-burgundy"
        >
          {t("cancel")}
        </button>
      </div>
      {err ? (
        <div className="text-xs font-semibold text-brand-burgundy sm:col-span-5">
          {err}
        </div>
      ) : null}
    </div>
  );
}
