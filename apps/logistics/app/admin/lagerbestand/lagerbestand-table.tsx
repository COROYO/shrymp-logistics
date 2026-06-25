"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

export type LagerbestandRow = {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  onHand: number;
  reserved: number;
  difference: number;
};

type SortKey =
  | "productId"
  | "variantId"
  | "productTitle"
  | "variantTitle"
  | "sku"
  | "onHand"
  | "reserved"
  | "difference";

type SortState = { key: SortKey; dir: "asc" | "desc" };

type ColumnFilters = Record<SortKey, string>;

const EMPTY_FILTERS: ColumnFilters = {
  productId: "",
  variantId: "",
  productTitle: "",
  variantTitle: "",
  sku: "",
  onHand: "",
  reserved: "",
  difference: "",
};

function compare(a: LagerbestandRow, b: LagerbestandRow, key: SortKey): number {
  switch (key) {
    case "productId":
      return a.productId.localeCompare(b.productId);
    case "variantId":
      return a.variantId.localeCompare(b.variantId);
    case "productTitle":
      return a.productTitle.localeCompare(b.productTitle);
    case "variantTitle":
      return a.variantTitle.localeCompare(b.variantTitle);
    case "sku":
      return (a.sku ?? "").localeCompare(b.sku ?? "");
    case "onHand":
      return a.onHand - b.onHand;
    case "reserved":
      return a.reserved - b.reserved;
    case "difference":
      return a.difference - b.difference;
  }
}

function matchesFilter(value: string, needle: string): boolean {
  if (!needle) return true;
  return value.toLowerCase().includes(needle.toLowerCase());
}

function matchesNumericFilter(value: number, needle: string): boolean {
  if (!needle) return true;
  return String(value).includes(needle.trim());
}

export function LagerbestandTable({ rows }: { rows: LagerbestandRow[] }) {
  const t = useTranslations("lagerbestand");
  const [sort, setSort] = useState<SortState>({
    key: "productTitle",
    dir: "asc",
  });
  const [filters, setFilters] = useState<ColumnFilters>(EMPTY_FILTERS);

  const filtered = useMemo(() => {
    let out = rows.filter((r) => {
      return (
        matchesFilter(r.productId, filters.productId) &&
        matchesFilter(r.variantId, filters.variantId) &&
        matchesFilter(r.productTitle, filters.productTitle) &&
        matchesFilter(r.variantTitle, filters.variantTitle) &&
        matchesFilter(r.sku ?? "", filters.sku) &&
        matchesNumericFilter(r.onHand, filters.onHand) &&
        matchesNumericFilter(r.reserved, filters.reserved) &&
        matchesNumericFilter(r.difference, filters.difference)
      );
    });

    out = [...out].sort((a, b) => {
      const cmp = compare(a, b, sort.key);
      return sort.dir === "asc" ? cmp : -cmp;
    });

    return out;
  }, [rows, filters, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : {
            key,
            dir:
              key === "onHand" || key === "reserved" || key === "difference"
                ? "desc"
                : "asc",
          },
    );
  }

  function setFilter(key: SortKey, value: string) {
    setFilters((cur) => ({ ...cur, [key]: value }));
  }

  const resetDisabled = Object.values(filters).every((v) => !v);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">{t("table.eyebrow")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {t("table.count", { filtered: filtered.length, total: rows.length })}
          </h2>
        </div>
        <button
          type="button"
          disabled={resetDisabled}
          onClick={() => setFilters(EMPTY_FILTERS)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 transition hover:border-brand-navy hover:text-brand-navy disabled:opacity-40"
        >
          {t("table.reset")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table-brand">
          <thead>
            <tr>
              <SortableTh
                label={t("table.productId")}
                active={sort.key === "productId"}
                dir={sort.dir}
                onClick={() => toggleSort("productId")}
              />
              <SortableTh
                label={t("table.variantId")}
                active={sort.key === "variantId"}
                dir={sort.dir}
                onClick={() => toggleSort("variantId")}
              />
              <SortableTh
                label={t("table.productTitle")}
                active={sort.key === "productTitle"}
                dir={sort.dir}
                onClick={() => toggleSort("productTitle")}
              />
              <SortableTh
                label={t("table.variantTitle")}
                active={sort.key === "variantTitle"}
                dir={sort.dir}
                onClick={() => toggleSort("variantTitle")}
              />
              <SortableTh
                label={t("table.sku")}
                active={sort.key === "sku"}
                dir={sort.dir}
                onClick={() => toggleSort("sku")}
              />
              <SortableTh
                label={t("table.onHand")}
                active={sort.key === "onHand"}
                dir={sort.dir}
                align="right"
                onClick={() => toggleSort("onHand")}
              />
              <SortableTh
                label={t("table.reserved")}
                active={sort.key === "reserved"}
                dir={sort.dir}
                align="right"
                onClick={() => toggleSort("reserved")}
              />
              <SortableTh
                label={t("table.difference")}
                active={sort.key === "difference"}
                dir={sort.dir}
                align="right"
                onClick={() => toggleSort("difference")}
              />
            </tr>
            <tr className="bg-zinc-50/80">
              <FilterTh
                value={filters.productId}
                onChange={(v) => setFilter("productId", v)}
                placeholder={t("table.filter")}
              />
              <FilterTh
                value={filters.variantId}
                onChange={(v) => setFilter("variantId", v)}
                placeholder={t("table.filter")}
              />
              <FilterTh
                value={filters.productTitle}
                onChange={(v) => setFilter("productTitle", v)}
                placeholder={t("table.filter")}
              />
              <FilterTh
                value={filters.variantTitle}
                onChange={(v) => setFilter("variantTitle", v)}
                placeholder={t("table.filter")}
              />
              <FilterTh
                value={filters.sku}
                onChange={(v) => setFilter("sku", v)}
                placeholder={t("table.filter")}
              />
              <FilterTh
                value={filters.onHand}
                onChange={(v) => setFilter("onHand", v)}
                placeholder={t("table.filter")}
                align="right"
              />
              <FilterTh
                value={filters.reserved}
                onChange={(v) => setFilter("reserved", v)}
                placeholder={t("table.filter")}
                align="right"
              />
              <FilterTh
                value={filters.difference}
                onChange={(v) => setFilter("difference", v)}
                placeholder={t("table.filter")}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-6 py-10 text-center text-sm text-brand-navy/60"
                >
                  {t("table.empty")}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.variantId}>
                  <td className="font-mono text-xs text-brand-navy/70">
                    {r.productId}
                  </td>
                  <td className="font-mono text-xs text-brand-navy/70">
                    {r.variantId}
                  </td>
                  <td className="text-sm font-semibold text-brand-navy">
                    {r.productTitle}
                  </td>
                  <td className="text-xs text-brand-navy/80">{r.variantTitle}</td>
                  <td className="font-mono text-xs text-brand-navy/70">
                    {r.sku ?? "—"}
                  </td>
                  <td className="text-right text-base font-bold tabular-nums text-brand-navy">
                    {r.onHand}
                  </td>
                  <td
                    className={`text-right text-base font-bold tabular-nums ${
                      r.reserved > 0 ? "text-amber-700" : "text-brand-navy/50"
                    }`}
                  >
                    {r.reserved}
                  </td>
                  <td
                    className={`text-right text-base font-bold tabular-nums ${
                      r.difference < 0
                        ? "text-brand-burgundy"
                        : r.difference > 0
                          ? "text-emerald-700"
                          : "text-brand-navy/50"
                    }`}
                  >
                    {r.difference}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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
          align === "right" ? "ml-auto" : ""
        } ${active ? "text-brand-burgundy" : ""}`}
      >
        {label}
        <span className="text-[9px] opacity-70">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function FilterTh({
  value,
  onChange,
  placeholder,
  align,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  align?: "right";
}) {
  return (
    <th className={`py-2 ${align === "right" ? "text-right" : ""}`}>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full min-w-[4.5rem] rounded border border-zinc-300 bg-white px-2 py-1 text-xs shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy/20 ${
          align === "right" ? "text-right" : ""
        }`}
      />
    </th>
  );
}
