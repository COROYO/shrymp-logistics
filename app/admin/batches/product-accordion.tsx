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
          className="w-full sm:w-96 rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <div className="text-xs text-zinc-500">
          {filtered.length} von {rows.length}
        </div>
      </div>

      <ul className="space-y-2">
        {filtered.map((p) => {
          const open = openIds.has(p.id);
          return (
            <li
              key={p.id}
              className="rounded-lg border border-zinc-200 bg-white overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-zinc-50"
              >
                <div className="flex-shrink-0 h-14 w-14 rounded-md bg-zinc-100 overflow-hidden">
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
                    <div className="h-14 w-14 grid place-items-center text-xs text-zinc-400">
                      —
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.title}</div>
                  <div className="text-xs text-zinc-500">
                    {p.variants.length} Variant
                    {p.variants.length === 1 ? "" : "en"} ·{" "}
                    {p.batchCount} Charge{p.batchCount === 1 ? "" : "n"}
                  </div>
                </div>
                <div className="hidden sm:block text-right">
                  <div className="text-xs uppercase tracking-wide text-zinc-500">
                    On Hand
                  </div>
                  <div className="text-base font-semibold">{p.totalOnHand}</div>
                </div>
                <div className="hidden sm:block text-right">
                  <div className="text-xs uppercase tracking-wide text-zinc-500">
                    Available
                  </div>
                  <div
                    className={`text-base font-semibold ${
                      p.totalAvailable <= 0 ? "text-red-700" : ""
                    }`}
                  >
                    {p.totalAvailable}
                  </div>
                </div>
                <div
                  className={`ml-2 transition-transform ${
                    open ? "rotate-90" : ""
                  }`}
                  aria-hidden
                >
                  ▶
                </div>
              </button>

              {open ? (
                <div className="border-t border-zinc-200 bg-zinc-50/50 p-4 space-y-4">
                  {p.variants.length === 0 ? (
                    <p className="text-sm text-zinc-500">
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
