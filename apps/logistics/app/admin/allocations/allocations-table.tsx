"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

export type AllocationTableRow = {
  id: string;
  orderId: string;
  orderName: string;
  orderStatus: string;
  productTitle: string;
  variantTitle: string | null;
  chargeNumber: string;
  batchId: string;
  expiryDateIso: string | null;
  variantId: string;
  sku: string | null;
  qty: number;
  reservedIso: string | null;
  consumedIso: string | null;
  released: boolean;
  releaseReason: string | null;
  runId: string;
};

type SortKey =
  | "orderName"
  | "product"
  | "chargeNumber"
  | "expiry"
  | "sku"
  | "qty"
  | "status"
  | "reserved";

type SortState = { key: SortKey; dir: "asc" | "desc" };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE");
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE");
}

/**
 * Status sort weight — orders the status column in the natural "still pending"
 * → "shipped" → "released" sequence rather than alphabetically.
 */
function statusWeight(r: AllocationTableRow): number {
  if (!r.consumedIso) return 0; // reserviert
  if (r.released) return 2; // released
  return 1; // konsumiert
}

function compare(
  a: AllocationTableRow,
  b: AllocationTableRow,
  key: SortKey,
): number {
  switch (key) {
    case "orderName":
      return a.orderName.localeCompare(b.orderName);
    case "product":
      return a.productTitle.localeCompare(b.productTitle);
    case "chargeNumber":
      return a.chargeNumber.localeCompare(b.chargeNumber);
    case "expiry": {
      const aa = a.expiryDateIso ?? "";
      const bb = b.expiryDateIso ?? "";
      if (!aa && !bb) return 0;
      if (!aa) return 1;
      if (!bb) return -1;
      return aa.localeCompare(bb);
    }
    case "sku":
      return (a.sku ?? "").localeCompare(b.sku ?? "");
    case "qty":
      return a.qty - b.qty;
    case "status":
      return statusWeight(a) - statusWeight(b);
    case "reserved":
      return (a.reservedIso ?? "").localeCompare(b.reservedIso ?? "");
  }
}

export function AllocationsTable({ rows }: { rows: AllocationTableRow[] }) {
  const [q, setQ] = useState("");
  const [chargeFilter, setChargeFilter] = useState<string>("");
  const [productFilter, setProductFilter] = useState<string>("");
  const [sort, setSort] = useState<SortState>({
    key: "reserved",
    dir: "desc",
  });

  // Distinct charge + product values for the dropdowns. Sorted so the menu
  // looks the same no matter what the underlying data order is.
  const allCharges = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.chargeNumber);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);
  const allProducts = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.productTitle);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows;
    if (chargeFilter) {
      out = out.filter((r) => r.chargeNumber === chargeFilter);
    }
    if (productFilter) {
      out = out.filter((r) => r.productTitle === productFilter);
    }
    if (needle) {
      out = out.filter((r) => {
        return (
          r.orderName.toLowerCase().includes(needle) ||
          r.orderId.toLowerCase().includes(needle) ||
          r.productTitle.toLowerCase().includes(needle) ||
          (r.variantTitle ?? "").toLowerCase().includes(needle) ||
          r.chargeNumber.toLowerCase().includes(needle) ||
          (r.sku ?? "").toLowerCase().includes(needle) ||
          r.orderStatus.toLowerCase().includes(needle)
        );
      });
    }
    const sorted = [...out].sort((a, b) => {
      const cmp = compare(a, b, sort.key);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, q, chargeFilter, productFilter, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : // Sensible default per column: dates default desc (newest first),
          // qty desc (biggest first), everything else asc.
          { key, dir: key === "reserved" || key === "qty" ? "desc" : "asc" },
    );
  }

  const resetDisabled = !q && !chargeFilter && !productFilter;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-6 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Allokationen</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {filtered.length} von {rows.length} Zuordnung
            {rows.length === 1 ? "" : "en"}
          </h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="search"
            placeholder="Order, Produkt, SKU, Charge…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 sm:w-64"
          />
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          >
            <option value="">Alle Produkte</option>
            {allProducts.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={chargeFilter}
            onChange={(e) => setChargeFilter(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          >
            <option value="">Alle Chargen</option>
            {allCharges.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={resetDisabled}
            onClick={() => {
              setQ("");
              setChargeFilter("");
              setProductFilter("");
            }}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 transition hover:border-brand-navy hover:text-brand-navy disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-brand-navy/60">
          Keine Allokationen für diesen Filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-brand">
            <thead>
              <tr>
                <SortableTh
                  label="Order"
                  active={sort.key === "orderName"}
                  dir={sort.dir}
                  onClick={() => toggleSort("orderName")}
                />
                <SortableTh
                  label="Produkt"
                  active={sort.key === "product"}
                  dir={sort.dir}
                  onClick={() => toggleSort("product")}
                />
                <SortableTh
                  label="Charge"
                  active={sort.key === "chargeNumber"}
                  dir={sort.dir}
                  onClick={() => toggleSort("chargeNumber")}
                />
                <SortableTh
                  label="MHD"
                  active={sort.key === "expiry"}
                  dir={sort.dir}
                  onClick={() => toggleSort("expiry")}
                />
                <SortableTh
                  label="SKU"
                  active={sort.key === "sku"}
                  dir={sort.dir}
                  onClick={() => toggleSort("sku")}
                />
                <SortableTh
                  label="Menge"
                  active={sort.key === "qty"}
                  dir={sort.dir}
                  align="right"
                  onClick={() => toggleSort("qty")}
                />
                <SortableTh
                  label="Status"
                  active={sort.key === "status"}
                  dir={sort.dir}
                  onClick={() => toggleSort("status")}
                />
                <SortableTh
                  label="Reserviert"
                  active={sort.key === "reserved"}
                  dir={sort.dir}
                  onClick={() => toggleSort("reserved")}
                />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/admin/orders/${r.orderId}`}
                      className="font-mono font-semibold text-brand-navy transition hover:text-brand-burgundy"
                    >
                      {r.orderName}
                    </Link>
                    <div className="mt-0.5">
                      <span className="chip chip-soft">{r.orderStatus}</span>
                    </div>
                  </td>
                  <td className="text-xs text-brand-navy/80">
                    <div className="font-semibold">{r.productTitle}</div>
                    {r.variantTitle ? (
                      <div className="text-brand-navy/60">{r.variantTitle}</div>
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setChargeFilter(r.chargeNumber)}
                      className="rounded-md bg-brand-navy px-2 py-0.5 font-mono text-xs font-semibold text-white transition hover:bg-brand-burgundy"
                      title="Nach dieser Charge filtern"
                    >
                      {r.chargeNumber}
                    </button>
                  </td>
                  <td className="text-xs text-brand-navy/70">
                    {formatExpiry(r.expiryDateIso)}
                  </td>
                  <td className="font-mono text-xs text-brand-navy/70">
                    {r.sku ?? "—"}
                  </td>
                  <td className="text-right text-base font-bold text-brand-navy">
                    {r.qty}
                  </td>
                  <td>
                    {r.consumedIso ? (
                      r.released ? (
                        <span
                          className="text-xs text-brand-burgundy"
                          title={r.releaseReason ?? undefined}
                        >
                          ↩ released
                          <div className="text-[10px] text-brand-navy/50">
                            {formatDate(r.consumedIso)}
                          </div>
                        </span>
                      ) : (
                        <span className="text-xs text-emerald-700">
                          ✓ {formatDate(r.consumedIso)}
                        </span>
                      )
                    ) : (
                      <span className="chip chip-amber">reserviert</span>
                    )}
                  </td>
                  <td className="text-xs text-brand-navy/60">
                    {formatDate(r.reservedIso)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SortableTh({
  label,
  active,
  dir,
  align,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  align?: "right";
  onClick: () => void;
}) {
  return (
    <th className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition hover:text-brand-burgundy ${
          active ? "text-brand-burgundy" : ""
        }`}
      >
        {label}
        <span className="text-[9px] opacity-70">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
