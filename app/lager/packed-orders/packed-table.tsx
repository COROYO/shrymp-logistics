"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { OrderNoteIcon } from "@/app/_components/order-note-icon";

export type PackedRow = {
  id: string;
  name: string;
  packedIso: string;
  itemCount: number;
  positionCount: number;
  city: string | null;
  tags: string[];
  isExpress: boolean;
  externallyFulfilled: boolean;
  customerNote: string | null;
};

export function PackedTable({ rows }: { rows: PackedRow[] }) {
  const t = useTranslations("packedOrders");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.city ?? "").toLowerCase().includes(q) ||
        r.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const allSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function handlePrintSlips() {
    if (selectedIds.length === 0) return;
    const url = `/lager/print-slips?ids=${selectedIds.join(",")}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="w-full max-w-xs rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy/20"
        />
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-brand-navy">
              {t("selected", { count: selected.size })}
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60 hover:text-brand-burgundy"
            >
              {t("clear")}
            </button>
            <button
              type="button"
              onClick={handlePrintSlips}
              className="inline-flex items-center gap-2 rounded-md bg-brand-burgundy px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-burgundy-dark"
            >
              {t("printSlips", { count: selected.size })}
            </button>
          </div>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-brand">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    aria-label={t("selectAll")}
                    className="h-4 w-4 cursor-pointer accent-brand-burgundy"
                  />
                </th>
                <th>{t("table.order")}</th>
                <th>{t("table.packed")}</th>
                <th>{t("table.items")}</th>
                <th>{t("table.city")}</th>
                <th>{t("table.tags")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const isSel = selected.has(o.id);
                return (
                  <tr
                    key={o.id}
                    className={isSel ? "bg-brand-navy/5" : undefined}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleRow(o.id)}
                        aria-label={t("selectRow")}
                        className="h-4 w-4 cursor-pointer accent-brand-burgundy"
                      />
                    </td>
                    <td className="font-mono text-sm font-bold text-brand-navy">
                      <span className="inline-flex items-center gap-1.5">
                        <OrderNoteIcon note={o.customerNote} />
                        {o.name}
                      </span>
                    </td>
                    <td className="text-sm text-brand-navy/60">
                      {o.packedIso
                        ? new Date(o.packedIso).toLocaleString("de-DE", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="text-sm">
                      <span className="font-semibold text-brand-navy">
                        {o.itemCount}
                      </span>{" "}
                      <span className="text-xs text-brand-navy/50">
                        ({o.positionCount} {t("table.positions")})
                      </span>
                    </td>
                    <td className="text-xs text-brand-navy/70">
                      {o.city ?? "—"}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {o.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className={
                              tag === "EXPRESS_DHL"
                                ? "chip chip-burgundy"
                                : "chip chip-soft"
                            }
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Link
                        href={`/lager/picking/${o.id}/slip`}
                        target="_blank"
                        className="text-sm font-semibold text-brand-burgundy hover:text-brand-burgundy-dark"
                      >
                        {t("reprint")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
