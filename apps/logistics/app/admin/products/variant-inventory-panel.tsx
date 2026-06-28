"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  adjustVariantStockAction,
  getVariantHistoryAction,
  receiveVariantStockAction,
  type ReceiveVariantActionState,
} from "./inventory-actions";
import type { BatchHistoryEntry } from "@/server/inventory/batch-history";
import { HistoryIcon } from "@/app/_components/icons";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import {
  LocationSelect,
  LocationStockBreakdown,
  type LocationOption,
} from "@/app/admin/_components/location-fields";
import type { VariantRow } from "./product-accordion";

export function VariantInventoryPanel({
  variant,
  priceLabel,
  locations,
  defaultLocationId,
}: {
  variant: VariantRow;
  priceLabel: string;
  locations: LocationOption[];
  defaultLocationId: string | null;
}) {
  const t = useTranslations("products.inventoryPanel");
  const tb = useTranslations("batches.panel");
  const ti = useTranslations("products.inventoryPanel");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [editing, setEditing] = useState(false);

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
                {tb("skuLabel")} {variant.sku} ·{" "}
              </>
            ) : null}
            {priceLabel}
          </div>
          <LocationStockBreakdown rows={variant.locationStock} />
        </div>
        <div className="grid grid-cols-3 gap-4 text-right">
          <Cell label={tb("onHandShort")} value={variant.onHand} />
          <Cell label={tb("reservedShort")} value={variant.reserved} />
          <Cell
            label={tb("availShort")}
            value={variant.available}
            tone={variant.available <= 0 ? "warn" : undefined}
          />
        </div>
      </div>

      <div className="border-t border-zinc-200 p-3">
        <div className="flex flex-wrap items-center gap-3">
          {!receiving && !editing ? (
            <>
              <button
                type="button"
                onClick={() => setReceiving(true)}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy transition hover:text-brand-burgundy-dark"
              >
                {t("receiveStock")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70 transition hover:text-brand-burgundy"
              >
                {t("adjustStock")}
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                title={tb("history")}
                className={`ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition hover:text-brand-burgundy ${
                  historyOpen ? "text-brand-burgundy" : "text-brand-navy/70"
                }`}
              >
                <HistoryIcon className="h-4 w-4" />
                {tb("history")}
              </button>
            </>
          ) : receiving ? (
            <ReceiveStockForm
              variantId={variant.id}
              locations={locations}
              defaultLocationId={defaultLocationId}
              onClose={() => setReceiving(false)}
            />
          ) : (
            <AdjustStockForm
              variant={variant}
              locations={locations}
              defaultLocationId={defaultLocationId}
              onClose={() => setEditing(false)}
            />
          )}
        </div>

        {historyOpen ? (
          <VariantHistoryList variantId={variant.id} />
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

function ReceiveStockForm({
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
  const tb = useTranslations("batches.panel");
  const ti = useTranslations("products.inventoryPanel");
  const [locationId, setLocationId] = useState(
    defaultLocationId ?? locations[0]?.id ?? "",
  );
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setErr(null);
    const fd = new FormData();
    fd.set("variantId", variantId);
    fd.set("locationId", locationId);
    fd.set("qty", qty);
    fd.set("note", notes);
    startTransition(async () => {
      const res: ReceiveVariantActionState = await receiveVariantStockAction(
        null,
        fd,
      );
      if (res?.ok) {
        dispatchAdminJobSuccess({
          title: ti("receiveStock"),
          message: `${qty} Stück eingebucht.`,
        });
        onClose();
      } else if (res) {
        dispatchAdminJobError({ title: ti("receiveStock"), message: res.error });
        setErr(res.error);
      }
    });
  }

  const input =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

  return (
    <div className="grid w-full grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
      <Field label="Standort">
        <LocationSelect
          locations={locations}
          value={locationId}
          onChange={setLocationId}
        />
      </Field>
      <Field label={tb("qtyPlaceholder")}>
        <input
          type="number"
          placeholder={tb("qtyPlaceholder")}
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className={`${input} text-right`}
        />
      </Field>
      <Field label={tb("note")}>
        <input
          type="text"
          placeholder={tb("notePlaceholder")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          className={input}
        />
      </Field>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !qty}
          className="btn-primary !px-4 !py-2"
        >
          {pending ? "…" : tb("save")}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70"
        >
          {tb("cancel")}
        </button>
      </div>
      {err ? (
        <div className="text-xs font-semibold text-brand-burgundy sm:col-span-3">
          {err}
        </div>
      ) : null}
    </div>
  );
}

function AdjustStockForm({
  variant,
  locations,
  defaultLocationId,
  onClose,
}: {
  variant: VariantRow;
  locations: LocationOption[];
  defaultLocationId: string | null;
  onClose: () => void;
}) {
  const tb = useTranslations("batches.panel");
  const ti = useTranslations("products.inventoryPanel");
  const [locationId, setLocationId] = useState(
    defaultLocationId ?? locations[0]?.id ?? "",
  );
  const locOnHand =
    variant.locationStock.find((r) => r.locationId === locationId)?.onHand ??
    variant.onHand;
  const [onHand, setOnHand] = useState(String(locOnHand));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onHandNum = onHand === "" ? undefined : Number(onHand);
  const changed =
    onHandNum !== undefined && onHandNum !== locOnHand;
  const delta = changed ? onHandNum - locOnHand : 0;

  function handleLocationChange(nextId: string) {
    setLocationId(nextId);
    const nextOnHand =
      variant.locationStock.find((r) => r.locationId === nextId)?.onHand ?? 0;
    setOnHand(String(nextOnHand));
    setReason("");
  }

  function handleSave() {
    if (onHandNum === undefined) return;
    setErr(null);
    startTransition(async () => {
      const res = await adjustVariantStockAction({
        variantId: variant.id,
        locationId,
        onHand: onHandNum,
        reason: changed ? reason : undefined,
      });
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: ti("adjustStock"),
          message: `Bestand auf ${onHandNum} gesetzt (${delta >= 0 ? `+${delta}` : delta}).`,
        });
        onClose();
      } else {
        dispatchAdminJobError({ title: ti("adjustStock"), message: res.error });
        setErr(res.error);
      }
    });
  }

  const input =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

  return (
    <div className="grid w-full grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
      <Field label="Standort">
        <LocationSelect
          locations={locations}
          value={locationId}
          onChange={handleLocationChange}
        />
      </Field>
      <Field label={tb("onHandShort")}>
        <input
          type="number"
          min={0}
          step={1}
          value={onHand}
          onChange={(e) => setOnHand(e.target.value)}
          className={`${input} text-right`}
        />
        {changed ? (
          <div
            className={`mt-1 text-[10px] font-bold tabular-nums ${
              delta >= 0 ? "text-emerald-700" : "text-brand-burgundy"
            }`}
          >
            {delta >= 0 ? `+${delta}` : delta}
          </div>
        ) : null}
      </Field>
      <Field label={tb("adjustReasonPlaceholder")}>
        <input
          type="text"
          placeholder={tb("adjustReasonPlaceholder")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          className={input}
        />
      </Field>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !changed}
          className="btn-primary !px-4 !py-2"
        >
          {pending ? "…" : tb("save")}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70"
        >
          {tb("cancel")}
        </button>
      </div>
      {err ? (
        <div className="text-xs font-semibold text-brand-burgundy sm:col-span-3">
          {err}
        </div>
      ) : null}
    </div>
  );
}

function VariantHistoryList({ variantId }: { variantId: string }) {
  const t = useTranslations("products.inventoryPanel");
  const tb = useTranslations("batches.panel");
  const ti = useTranslations("products.inventoryPanel");
  const [entries, setEntries] = useState<BatchHistoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVariantHistoryAction(variantId).then((res) => {
      if (cancelled) return;
      if (res.ok) setEntries(res.entries);
      else setErr(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [variantId]);

  return (
    <div className="mt-3 rounded-md bg-brand-cream/40 px-4 py-3">
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
          {tb("historyEmpty")}
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
                {tb(`movement.${e.type}`)}
              </span>
              <span
                className={`w-10 text-right font-bold tabular-nums ${
                  e.qty >= 0 ? "text-emerald-700" : "text-brand-burgundy"
                }`}
              >
                {e.qty >= 0 ? `+${e.qty}` : e.qty}
              </span>
              <span className="text-brand-navy/70">
                {e.userName ?? tb("systemActor")}
              </span>
              {e.note ? (
                <span className="text-brand-navy/50">· {e.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE");
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
