"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { VariantBatchPanel } from "./variant-batch-panel";
import {
  TOGGLEABLE_COLUMNS,
  useColumnVisibility,
  type BatchColumnKey,
} from "./columns";

export type BatchRow = {
  id: string;
  chargeNumber: string;
  expiryDateIso: string;
  /** Production date (ISO YYYY-MM-DD) — optional, audit-only. */
  productionDateIso: string | null;
  /** When the batch was booked into the system. */
  receivedAtIso: string | null;
  /** Who booked it — Firebase uid plus a human-readable label. */
  receivedByUid: string;
  receivedByName: string;
  remainingQty: number;
  initialQty: number;
  /**
   * Quantity actually sold (packed + shipped) from this batch — derived
   * from consumed, non-released allocations. Cancelled-and-released
   * allocations don't count.
   */
  soldQty: number;
  status: string;
  /** MHD passed or status already EXPIRED — still on shelf until archived. */
  expired: boolean;
  notes: string | null;
};

export type VariantRow = {
  id: string;
  title: string;
  sku: string | null;
  priceCents: number | null;
  currency: string | null;
  imageUrl: string | null;
  onHand: number;
  reserved: number;
  available: number;
  batches: BatchRow[];
};

export type ProductRow = {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  status: string;
  variants: VariantRow[];
  totalOnHand: number;
  totalAvailable: number;
  batchCount: number;
};

function formatPrice(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currency ?? "EUR",
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

export function ProductAccordion({ rows }: { rows: ProductRow[] }) {
  const t = useTranslations("batches.accordion");
  const tp = useTranslations("batches.panel");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const { cols, toggle: toggleCol, reset: resetCols } = useColumnVisibility();

  function toggle(id: string) {
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = filter.trim()
    ? rows.filter((r) => {
        const q = filter.toLowerCase();
        if (r.title.toLowerCase().includes(q)) return true;
        if (r.handle.toLowerCase().includes(q)) return true;
        return r.variants.some(
          (v) =>
            v.title.toLowerCase().includes(q) ||
            (v.sku && v.sku.toLowerCase().includes(q)),
        );
      })
    : rows;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder={t("search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 sm:w-96"
        />
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
          {t("filterCount", { filtered: filtered.length, total: rows.length })}
        </div>
        <div className="ml-auto">
          <ColumnMenu
            cols={cols}
            onToggle={toggleCol}
            onReset={resetCols}
            label={tp("columns")}
            resetLabel={tp("columnsReset")}
            columnLabel={(key) => tp(key === "production" ? "productionDate" : key)}
          />
        </div>
      </div>

      <ul className="space-y-3">
        {filtered.map((p) => {
          const open = openIds.has(p.id);
          return (
            <li key={p.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-brand-navy-50"
              >
                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-brand-cream ring-1 ring-zinc-200">
                  {p.imageUrl ? (
                    <Image
                      src={p.imageUrl}
                      alt={p.title}
                      width={56}
                      height={56}
                      className="h-14 w-14 object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="grid h-14 w-14 place-items-center text-xs text-brand-navy/40">
                      —
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-brand-navy">
                    {p.title}
                  </div>
                  <div className="text-xs text-brand-navy/60">
                    {t("variantsCharges", {
                      variants: p.variants.length,
                      batches: p.batchCount,
                    })}
                  </div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
                    {t("onHand")}
                  </div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-brand-navy">
                    {p.totalOnHand}
                  </div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
                    {t("available")}
                  </div>
                  <div
                    className={`mt-0.5 text-base font-bold tabular-nums ${
                      p.totalAvailable <= 0
                        ? "text-brand-burgundy"
                        : "text-brand-navy"
                    }`}
                  >
                    {p.totalAvailable}
                  </div>
                </div>
                <div
                  className={`ml-2 text-brand-navy/40 transition-transform ${
                    open ? "rotate-90" : ""
                  }`}
                  aria-hidden
                >
                  ▶
                </div>
              </button>

              {open ? (
                <div className="space-y-4 border-t border-zinc-200 bg-brand-cream/50 p-5">
                  {p.variants.length === 0 ? (
                    <p className="text-sm text-brand-navy/60">
                      {t("noVariants")}
                    </p>
                  ) : (
                    p.variants.map((v) => (
                      <VariantBatchPanel
                        key={v.id}
                        variant={v}
                        priceLabel={formatPrice(v.priceCents, v.currency)}
                        cols={cols}
                      />
                    ))
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ColumnMenu({
  cols,
  onToggle,
  onReset,
  label,
  resetLabel,
  columnLabel,
}: {
  cols: Record<BatchColumnKey, boolean>;
  onToggle: (key: BatchColumnKey) => void;
  onReset: () => void;
  label: string;
  resetLabel: string;
  columnLabel: (key: BatchColumnKey) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const hiddenCount = TOGGLEABLE_COLUMNS.filter((k) => !cols[k]).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/70 shadow-sm transition hover:border-brand-navy hover:text-brand-navy"
      >
        {label}
        {hiddenCount > 0 ? (
          <span className="rounded bg-brand-navy/10 px-1.5 py-0.5 text-[10px] tabular-nums text-brand-navy">
            −{hiddenCount}
          </span>
        ) : null}
        <span className="text-[9px] opacity-70">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          <ul className="space-y-0.5">
            {TOGGLEABLE_COLUMNS.map((key) => (
              <li key={key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-brand-navy transition hover:bg-brand-cream">
                  <input
                    type="checkbox"
                    checked={cols[key]}
                    onChange={() => onToggle(key)}
                    className="h-4 w-4 rounded border-zinc-300 text-brand-burgundy focus:ring-brand-navy/30"
                  />
                  {columnLabel(key)}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onReset}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/60 transition hover:bg-brand-cream hover:text-brand-navy"
          >
            {resetLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
