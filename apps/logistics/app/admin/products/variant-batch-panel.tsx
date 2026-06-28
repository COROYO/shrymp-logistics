"use client";
import { Fragment, useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  archiveBatchAction,
  editBatchAction,
  getBatchHistoryAction,
  receiveBatchAction,
  type ReceiveBatchActionState,
} from "./inventory-actions";
import type { BatchHistoryEntry } from "@/server/inventory/batch-history";
import { ArchiveIcon, EditIcon, HistoryIcon } from "@/app/_components/icons";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import {
  LocationSelect,
  LocationStockBreakdown,
  type LocationOption,
} from "@/app/admin/_components/location-fields";
import { TOGGLEABLE_COLUMNS, type ColumnVisibility } from "./columns";
import type { BatchRow, VariantRow } from "./product-accordion";

function isArchivedBatch(b: BatchRow): boolean {
  return (
    b.remainingQty <= 0 ||
    b.status === "DEPLETED" ||
    b.expired ||
    b.status === "EXPIRED"
  );
}

function isVisibleByDefault(b: BatchRow): boolean {
  return !isArchivedBatch(b);
}

/** Charge + location + actions are always shown; the rest are toggleable. */
function colSpanFor(cols: ColumnVisibility): number {
  return 3 + TOGGLEABLE_COLUMNS.filter((k) => cols[k]).length;
}

export function VariantBatchPanel({
  variant,
  priceLabel,
  cols,
  locations,
  defaultLocationId,
}: {
  variant: VariantRow;
  priceLabel: string;
  cols: ColumnVisibility;
  locations: LocationOption[];
  defaultLocationId: string | null;
}) {
  const t = useTranslations("batches.panel");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const colSpan = colSpanFor(cols);
  const archivedCount = variant.batches.filter(isArchivedBatch).length;
  const visibleBatches = showArchived
    ? variant.batches
    : variant.batches.filter(isVisibleByDefault);

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
          <LocationStockBreakdown rows={variant.locationStock} />
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
        <thead className="bg-brand-cream text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70">
          <tr>
            <th className="px-4 py-2">{t("charge")}</th>
            <th className="px-4 py-2">Standort</th>
            {cols.expiry ? <th className="px-4 py-2">{t("expiry")}</th> : null}
            {cols.production ? (
              <th className="px-4 py-2">{t("productionDate")}</th>
            ) : null}
            {cols.remaining ? (
              <th className="px-4 py-2 text-right">{t("remaining")}</th>
            ) : null}
            {cols.sold ? (
              <th className="px-4 py-2 text-right">{t("sold")}</th>
            ) : null}
            {cols.initial ? (
              <th className="px-4 py-2 text-right">{t("initial")}</th>
            ) : null}
            {cols.receivedAt ? (
              <th className="px-4 py-2">{t("receivedAt")}</th>
            ) : null}
            {cols.receivedBy ? (
              <th className="px-4 py-2">{t("receivedBy")}</th>
            ) : null}
            {cols.note ? <th className="px-4 py-2">{t("note")}</th> : null}
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {visibleBatches.length === 0 ? (
            <tr>
              <td
                colSpan={colSpan}
                className="px-4 py-3 text-xs text-brand-navy/60"
              >
                {t("noActiveBatch")}
              </td>
            </tr>
          ) : (
            visibleBatches.map((b) => (
              <Fragment key={b.id}>
                {editingId === b.id ? (
                  <EditBatchRow
                    batch={b}
                    cols={cols}
                    onClose={() => setEditingId(null)}
                  />
                ) : (
                  <BatchDisplayRow
                    batch={b}
                    cols={cols}
                    onEdit={() => setEditingId(b.id)}
                    historyOpen={historyId === b.id}
                    onToggleHistory={() =>
                      setHistoryId((cur) => (cur === b.id ? null : b.id))
                    }
                  />
                )}
                {historyId === b.id ? (
                  <BatchHistoryRow batchId={b.id} colSpan={colSpan} />
                ) : null}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 p-3">
        {adding ? (
          <NewBatchInlineForm
            variantId={variant.id}
            locations={locations}
            defaultLocationId={defaultLocationId}
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
        {archivedCount > 0 && !adding ? (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60 transition hover:text-brand-navy"
          >
            {showArchived
              ? t("hideArchived")
              : t("showArchived", { count: archivedCount })}
          </button>
        ) : null}
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
  cols,
  onEdit,
  historyOpen,
  onToggleHistory,
}: {
  batch: BatchRow;
  cols: ColumnVisibility;
  onEdit: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
}) {
  const t = useTranslations("batches.panel");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const archived = isArchivedBatch(batch);

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
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Charge",
          message: `Charge ${batch.chargeNumber} archiviert.`,
        });
      } else {
        dispatchAdminJobError({ title: "Charge", message: res.error });
        setErr(res.error);
      }
    });
  }

  return (
    <tr
      className={`align-top transition hover:bg-brand-navy-50 ${
        archived
          ? "bg-zinc-50/60 text-brand-navy/45"
          : batch.expired
            ? "bg-amber-50/70"
            : ""
      }`}
    >
      <td className="px-4 py-2.5 font-mono font-semibold">
        <span className="inline-flex flex-wrap items-center gap-2">
          {batch.chargeNumber}
          {batch.expired && !archived ? (
            <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
              {t("expiredBadge")}
            </span>
          ) : null}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs text-brand-navy/80">
        {batch.locationName ?? "—"}
      </td>
      {cols.expiry ? (
        <td
          className={`px-4 py-2.5 font-mono ${
            batch.expired && !archived
              ? "font-semibold text-amber-900"
              : "text-brand-navy/80"
          }`}
        >
          {batch.expiryDateIso || "—"}
        </td>
      ) : null}
      {cols.production ? (
        <td className="px-4 py-2.5 font-mono text-brand-navy/80">
          {batch.productionDateIso || "—"}
        </td>
      ) : null}
      {cols.remaining ? (
        <td className="px-4 py-2.5 text-right text-base font-bold text-brand-navy">
          {batch.remainingQty}
        </td>
      ) : null}
      {cols.sold ? (
        <td className="px-4 py-2.5 text-right text-emerald-700">
          {batch.soldQty > 0 ? batch.soldQty : "—"}
        </td>
      ) : null}
      {cols.initial ? (
        <td className="px-4 py-2.5 text-right text-brand-navy/50">
          {batch.initialQty}
        </td>
      ) : null}
      {cols.receivedAt ? (
        <td className="px-4 py-2.5 font-mono text-xs text-brand-navy/70">
          {batch.receivedAtIso || "—"}
        </td>
      ) : null}
      {cols.receivedBy ? (
        <td className="px-4 py-2.5 text-xs text-brand-navy/80">
          {batch.receivedByName}
        </td>
      ) : null}
      {cols.note ? (
        <td className="px-4 py-2.5 text-xs text-brand-navy/70">
          {batch.notes ?? ""}
        </td>
      ) : null}
      <td className="px-4 py-2.5 text-right">
        <div className="inline-flex gap-3 text-[11px] font-semibold uppercase tracking-[0.1em]">
          <button
            type="button"
            onClick={onToggleHistory}
            title={t("history")}
            className={`inline-flex items-center gap-1.5 transition hover:text-brand-burgundy ${
              historyOpen ? "text-brand-burgundy" : "text-brand-navy/70"
            }`}
          >
            <HistoryIcon className="h-4 w-4" />
            {t("history")}
          </button>
          <button
            type="button"
            onClick={onEdit}
            title={t("edit")}
            className="inline-flex items-center gap-1.5 text-brand-navy/70 transition hover:text-brand-burgundy"
          >
            <EditIcon className="h-4 w-4" />
            {t("edit")}
          </button>
          {!archived ? (
            <button
              type="button"
              onClick={handleArchive}
              disabled={pending}
              title={t("archive")}
              className="inline-flex items-center gap-1.5 text-brand-burgundy transition hover:text-brand-burgundy-dark disabled:opacity-50"
            >
              {pending ? (
                "…"
              ) : (
                <>
                  <ArchiveIcon className="h-4 w-4" />
                  {t("archive")}
                </>
              )}
            </button>
          ) : null}
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

function BatchHistoryRow({
  batchId,
  colSpan,
}: {
  batchId: string;
  colSpan: number;
}) {
  const t = useTranslations("batches.panel");
  const [entries, setEntries] = useState<BatchHistoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBatchHistoryAction(batchId).then((res) => {
      if (cancelled) return;
      if (res.ok) setEntries(res.entries);
      else setErr(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  return (
    <tr className="bg-brand-cream/40">
      <td colSpan={colSpan} className="px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
          {t("historyTitle")}
        </div>
        {entries === null && !err ? (
          <div className="mt-2 text-xs text-brand-navy/50">…</div>
        ) : null}
        {err ? (
          <div className="mt-2 text-xs font-semibold text-brand-burgundy">
            {err}
          </div>
        ) : null}
        {entries && entries.length === 0 ? (
          <div className="mt-2 text-xs text-brand-navy/50">
            {t("historyEmpty")}
          </div>
        ) : null}
        {entries && entries.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
              >
                <span className="w-36 font-mono text-brand-navy/60">
                  {formatDateTime(e.createdAtIso)}
                </span>
                <span className="w-28 font-semibold text-brand-navy/80">
                  {t(`movement.${e.type}`)}
                </span>
                <span
                  className={`w-10 text-right font-bold tabular-nums ${
                    e.qty >= 0 ? "text-emerald-700" : "text-brand-burgundy"
                  }`}
                >
                  {e.qty >= 0 ? `+${e.qty}` : e.qty}
                </span>
                <span className="text-brand-navy/70">
                  {e.userName ?? t("systemActor")}
                </span>
                {e.note ? (
                  <span className="text-brand-navy/50">· {e.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </td>
    </tr>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE");
}

function EditBatchRow({
  batch,
  cols,
  onClose,
}: {
  batch: BatchRow;
  cols: ColumnVisibility;
  onClose: () => void;
}) {
  const t = useTranslations("batches.panel");
  const [chargeNumber, setChargeNumber] = useState(batch.chargeNumber);
  const [expiry, setExpiry] = useState(batch.expiryDateIso);
  const [production, setProduction] = useState(batch.productionDateIso ?? "");
  const [remaining, setRemaining] = useState(String(batch.remainingQty));
  const [notes, setNotes] = useState(batch.notes ?? "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remainingNum = remaining === "" ? undefined : Number(remaining);
  const qtyChanged =
    remainingNum !== undefined && remainingNum !== batch.remainingQty;
  const qtyDelta = qtyChanged ? remainingNum - batch.remainingQty : 0;

  function handleSave() {
    setErr(null);
    const productionInitial = batch.productionDateIso ?? "";
    startTransition(async () => {
      const res = await editBatchAction({
        batchId: batch.id,
        chargeNumber:
          chargeNumber !== batch.chargeNumber ? chargeNumber : undefined,
        expiryDate: expiry !== batch.expiryDateIso ? expiry : undefined,
        productionDate:
          production !== productionInitial ? production : undefined,
        remainingQty: qtyChanged ? remainingNum : undefined,
        notes: notes !== (batch.notes ?? "") ? notes : undefined,
        reason: qtyChanged ? reason : undefined,
      });
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Charge",
          message: `Charge ${chargeNumber} gespeichert.`,
        });
        onClose();
      } else {
        dispatchAdminJobError({ title: "Charge", message: res.error });
        setErr(res.error);
      }
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
      <td className="px-4 py-2 text-xs text-brand-navy/70">
        {batch.locationName ?? "—"}
      </td>
      {cols.expiry ? (
        <td className="px-4 py-2">
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className={`${inlineInput} w-36 font-mono`}
          />
        </td>
      ) : null}
      {cols.production ? (
        <td className="px-4 py-2">
          <input
            type="date"
            value={production}
            onChange={(e) => setProduction(e.target.value)}
            className={`${inlineInput} w-36 font-mono`}
          />
        </td>
      ) : null}
      {cols.remaining ? (
        <td className="px-4 py-2 text-right">
          <input
            type="number"
            min={0}
            step={1}
            value={remaining}
            onChange={(e) => setRemaining(e.target.value)}
            className={`${inlineInput} w-20 text-right`}
          />
          {qtyChanged ? (
            <div
              className={`mt-1 text-[10px] font-bold tabular-nums ${
                qtyDelta >= 0 ? "text-emerald-700" : "text-brand-burgundy"
              }`}
            >
              {qtyDelta >= 0 ? `+${qtyDelta}` : qtyDelta}
            </div>
          ) : null}
        </td>
      ) : null}
      {cols.sold ? (
        <td className="px-4 py-2 text-right text-emerald-700/70">
          {batch.soldQty > 0 ? batch.soldQty : "—"}
        </td>
      ) : null}
      {cols.initial ? (
        <td className="px-4 py-2 text-right text-brand-navy/50">
          {batch.initialQty}
        </td>
      ) : null}
      {cols.receivedAt ? (
        <td className="px-4 py-2 font-mono text-xs text-brand-navy/60">
          {batch.receivedAtIso || "—"}
        </td>
      ) : null}
      {cols.receivedBy ? (
        <td className="px-4 py-2 text-xs text-brand-navy/70">
          {batch.receivedByName}
        </td>
      ) : null}
      {cols.note ? (
        <td className="px-4 py-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            placeholder={t("notePlaceholder")}
            className={`${inlineInput} w-full`}
          />
          {qtyChanged ? (
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder={t("adjustReasonPlaceholder")}
              className={`${inlineInput} mt-1 w-full border-amber-300`}
            />
          ) : null}
        </td>
      ) : null}
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
  locations,
  defaultLocationId,
  onClose,
}: {
  variantId: string;
  locations: LocationOption[];
  defaultLocationId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("batches.panel");
  const [chargeNumber, setChargeNumber] = useState("");
  const [locationId, setLocationId] = useState(
    defaultLocationId ?? locations[0]?.id ?? "",
  );
  const [expiry, setExpiry] = useState("");
  // Produktionsdatum default = heute (lokale Zeitzone). Wareneingänge werden
  // praktisch immer am Tag der Produktion oder kurz danach gebucht, deshalb
  // ist "heute" der mit Abstand häufigste Wert — überschreibbar.
  const [production, setProduction] = useState(todayLocalYmd());
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setErr(null);
    const fd = new FormData();
    fd.set("variantId", variantId);
    fd.set("locationId", locationId);
    fd.set("chargeNumber", chargeNumber);
    fd.set("expiryDate", expiry);
    if (production) fd.set("productionDate", production);
    fd.set("qty", qty);
    fd.set("note", notes);
    startTransition(async () => {
      const res: ReceiveBatchActionState = await receiveBatchAction(null, fd);
      if (res?.ok) {
        dispatchAdminJobSuccess({
          title: "Charge",
          message: `Charge ${chargeNumber || "neu"} · ${qty} Stück eingebucht.`,
        });
        onClose();
      } else if (res) {
        dispatchAdminJobError({ title: "Charge", message: res.error });
        setErr(res.error);
      }
    });
  }

  const input =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

  return (
    <div className="grid w-full grid-cols-1 items-end gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_2fr_auto]">
      <Field label={t("charge")}>
        <input
          type="text"
          placeholder={t("chargeNoPlaceholder")}
          value={chargeNumber}
          onChange={(e) => setChargeNumber(e.target.value)}
          className={`${input} font-mono`}
        />
      </Field>
      <Field label="Standort">
        <LocationSelect
          locations={locations}
          value={locationId}
          onChange={setLocationId}
        />
      </Field>
      <Field label={t("expiry")}>
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className={`${input} font-mono`}
        />
      </Field>
      <Field label={t("productionDate")}>
        <input
          type="date"
          value={production}
          onChange={(e) => setProduction(e.target.value)}
          className={`${input} font-mono`}
        />
      </Field>
      <Field label={t("qtyPlaceholder")}>
        <input
          type="number"
          placeholder={t("qtyPlaceholder")}
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className={`${input} text-right`}
        />
      </Field>
      <Field label={t("note")}>
        <input
          type="text"
          placeholder={t("notePlaceholder")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          className={input}
        />
      </Field>
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
        <div className="text-xs font-semibold text-brand-burgundy sm:col-span-6">
          {err}
        </div>
      ) : null}
    </div>
  );
}

/**
 * YYYY-MM-DD for the current calendar day in the user's local timezone.
 * `toISOString` would shift to UTC and roll over near midnight — we use the
 * local components instead so the warehouse staff always sees "their" today.
 */
function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </span>
      {children}
    </label>
  );
}
