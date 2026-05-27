"use client";
import { useState } from "react";
import Image from "next/image";
import { VariantBatchPanel } from "./variant-batch-panel";

export type BatchRow = {
  id: string;
  chargeNumber: string;
  expiryDateIso: string;
  remainingQty: number;
  initialQty: number;
  status: string;
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
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

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
          placeholder="Produkt, Variante oder SKU suchen…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 sm:w-96"
        />
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
          {filtered.length} von {rows.length}
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
                    {p.variants.length} Variant
                    {p.variants.length === 1 ? "" : "en"} · {p.batchCount}{" "}
                    Charge{p.batchCount === 1 ? "" : "n"}
                  </div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
                    On Hand
                  </div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-brand-navy">
                    {p.totalOnHand}
                  </div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/50">
                    Available
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
                      Keine Varianten gesynct.
                    </p>
                  ) : (
                    p.variants.map((v) => (
                      <VariantBatchPanel
                        key={v.id}
                        variant={v}
                        priceLabel={formatPrice(v.priceCents, v.currency)}
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
