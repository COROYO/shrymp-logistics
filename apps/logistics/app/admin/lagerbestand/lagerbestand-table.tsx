"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  adjustStockAction,
  updateProductTitleAction,
  updateVariantSkuAction,
} from "./actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export type LagerbestandRow = {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  locationId: string | null;
  locationName: string | null;
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
  | "locationName"
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
  locationName: "",
  onHand: "",
  reserved: "",
  difference: "",
};

type VariantLocation = {
  locationId: string;
  locationName: string;
  onHand: number;
};

type VariantGroup = {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  onHand: number;
  reserved: number;
  difference: number;
  locations: VariantLocation[];
};

// Flatten per-variant×location rows (plus the "Σ Variante" summary row) coming
// from the API into one group per variant. Locations become collapsible children.
function groupRows(rows: LagerbestandRow[]): VariantGroup[] {
  const byVariant = new Map<string, LagerbestandRow[]>();
  for (const r of rows) {
    const arr = byVariant.get(r.variantId);
    if (arr) arr.push(r);
    else byVariant.set(r.variantId, [r]);
  }

  const groups: VariantGroup[] = [];
  for (const group of byVariant.values()) {
    const summary = group.find((r) => r.locationName === "Σ Variante");
    const totals = summary ?? group[0]!;
    const locations = group
      .filter((r) => r.locationId !== null && r.locationName !== "Σ Variante")
      .map((r) => ({
        locationId: r.locationId!,
        locationName: r.locationName ?? r.locationId!,
        onHand: r.onHand,
      }));

    groups.push({
      productId: totals.productId,
      variantId: totals.variantId,
      productTitle: totals.productTitle,
      variantTitle: totals.variantTitle,
      sku: totals.sku,
      onHand: totals.onHand,
      reserved: totals.reserved,
      difference: totals.difference,
      locations,
    });
  }
  return groups;
}

function compare(a: VariantGroup, b: VariantGroup, key: SortKey): number {
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
    case "locationName":
      return a.locations.length - b.locations.length;
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

type EditTarget =
  | { kind: "title"; productId: string; current: string }
  | { kind: "sku"; variantId: string; current: string | null }
  | {
      kind: "onhand";
      variantId: string;
      locationId: string | null;
      current: number;
    };

type CellStatus = "idle" | "saving" | "success" | "error";

export function LagerbestandTable({
  rows,
  onReload,
}: {
  rows: LagerbestandRow[];
  onReload?: () => Promise<void> | void;
}) {
  const t = useTranslations("lagerbestand");
  const [sort, setSort] = useState<SortState>({
    key: "productTitle",
    dir: "asc",
  });
  const [filters, setFilters] = useState<ColumnFilters>(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [locationId, setLocationId] = useState<string>("");
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [feedback, setFeedback] = useState<{
    key: string;
    state: Exclude<CellStatus, "idle">;
  } | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  function cellStatus(key: string): CellStatus {
    return feedback && feedback.key === key ? feedback.state : "idle";
  }

  // Per-cell status: spinner while saving, then a short check/cross. A fresh
  // edit on another cell cancels a pending auto-clear of the previous one.
  function flashFeedback(key: string, state: Exclude<CellStatus, "idle">) {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setFeedback({ key, state });
    if (state === "success" || state === "error") {
      clearTimer.current = setTimeout(() => {
        setFeedback((cur) => (cur && cur.key === key ? null : cur));
        clearTimer.current = null;
      }, 1500);
    }
  }

  function mapEditError(code: string): string {
    switch (code) {
      case "forbidden":
        return t("edit.errForbidden");
      case "batches_enabled":
        return t("edit.batchesLocked");
      case "invalid_qty":
        return t("edit.invalidQty");
      case "no_location":
        return t("edit.noLocation");
      case "empty_title":
        return t("edit.emptyTitle");
      case "missing_scope":
        return t("edit.missingScope");
      case "not_found":
        return t("edit.notFound");
      default:
        return code;
    }
  }

  async function runEdit(
    key: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMsg: string,
  ) {
    setEditing(null);
    flashFeedback(key, "saving");
    try {
      const res = await action();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: t("edit.successTitle"),
          message: successMsg,
        });
        // Keep the spinner until the authoritative numbers are back, then ✓.
        await onReload?.();
        flashFeedback(key, "success");
      } else {
        dispatchAdminJobError({
          title: t("edit.errorTitle"),
          message: mapEditError(res.error ?? "unknown"),
        });
        flashFeedback(key, "error");
      }
    } catch {
      dispatchAdminJobError({
        title: t("edit.errorTitle"),
        message: t("edit.unknown"),
      });
      flashFeedback(key, "error");
    }
  }

  function commitTitle(productId: string, current: string, value: string) {
    const next = value.trim();
    if (!next) {
      dispatchAdminJobError({
        title: t("edit.errorTitle"),
        message: t("edit.emptyTitle"),
      });
      setEditing(null);
      return;
    }
    if (next === current) {
      setEditing(null);
      return;
    }
    void runEdit(
      `title:${productId}`,
      () => updateProductTitleAction({ productId, title: next }),
      t("edit.nameSaved"),
    );
  }

  function commitSku(variantId: string, current: string | null, value: string) {
    const next = value.trim();
    if (next === (current ?? "")) {
      setEditing(null);
      return;
    }
    void runEdit(
      `sku:${variantId}`,
      () => updateVariantSkuAction({ variantId, sku: next }),
      t("edit.skuSaved"),
    );
  }

  function commitOnHand(
    variantId: string,
    locId: string | null,
    current: number,
    value: string,
  ) {
    const next = Number(value);
    if (!Number.isInteger(next) || next < 0) {
      dispatchAdminJobError({
        title: t("edit.errorTitle"),
        message: t("edit.invalidQty"),
      });
      setEditing(null);
      return;
    }
    if (next === current) {
      setEditing(null);
      return;
    }
    void runEdit(
      `onhand:${variantId}:${locId ?? "default"}`,
      () => adjustStockAction({ variantId, locationId: locId, onHand: next }),
      t("edit.stockSaved"),
    );
  }

  const groups = useMemo(() => groupRows(rows), [rows]);

  const locationOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const g of groups) {
      for (const l of g.locations) byId.set(l.locationId, l.locationName);
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groups]);

  // When a single location is pre-selected, collapse each variant to that
  // location's stock only (reserved/difference are variant-level, so blanked).
  const view = useMemo(() => {
    if (!locationId) return groups;
    return groups
      .filter((g) => g.locations.some((l) => l.locationId === locationId))
      .map((g) => {
        const loc = g.locations.find((l) => l.locationId === locationId)!;
        return {
          ...g,
          onHand: loc.onHand,
          reserved: 0,
          difference: loc.onHand,
          locations: [loc],
        };
      });
  }, [groups, locationId]);

  const filtered = useMemo(() => {
    let out = view.filter((g) => {
      return (
        matchesFilter(g.productId, filters.productId) &&
        matchesFilter(g.variantId, filters.variantId) &&
        matchesFilter(g.productTitle, filters.productTitle) &&
        matchesFilter(g.variantTitle, filters.variantTitle) &&
        matchesFilter(g.sku ?? "", filters.sku) &&
        (filters.locationName === "" ||
          g.locations.some((l) =>
            matchesFilter(l.locationName, filters.locationName),
          )) &&
        matchesNumericFilter(g.onHand, filters.onHand) &&
        matchesNumericFilter(g.reserved, filters.reserved) &&
        matchesNumericFilter(g.difference, filters.difference)
      );
    });

    out = [...out].sort((a, b) => {
      const cmp = compare(a, b, sort.key);
      return sort.dir === "asc" ? cmp : -cmp;
    });

    return out;
  }, [view, filters, sort]);

  function toggleExpanded(variantId: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

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
            {t("table.count", {
              filtered: filtered.length,
              total: groups.length,
            })}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {locationOptions.length > 0 && (
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70">
              <span className="hidden sm:inline">Standort</span>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium normal-case tracking-normal text-brand-navy shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy/20"
              >
                <option value="">Alle Standorte</option>
                {locationOptions.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={resetDisabled}
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 transition hover:border-brand-navy hover:text-brand-navy disabled:opacity-40"
          >
            {t("table.reset")}
          </button>
        </div>
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
                label="Standort"
                active={sort.key === "locationName"}
                dir={sort.dir}
                onClick={() => toggleSort("locationName")}
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
                value={filters.locationName}
                onChange={(v) => setFilter("locationName", v)}
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
                  colSpan={9}
                  className="px-6 py-10 text-center text-sm text-brand-navy/60"
                >
                  {t("table.empty")}
                </td>
              </tr>
            ) : (
              filtered.map((g) => {
                const hasMany = g.locations.length > 1;
                const isOpen = expanded.has(g.variantId);
                const onHandEditable = g.locations.length <= 1;
                const onHandLocId = g.locations[0]?.locationId ?? null;
                return (
                  <Fragment key={g.variantId}>
                    <tr>
                      <td className="font-mono text-xs text-brand-navy/70">
                        {g.productId}
                      </td>
                      <td className="font-mono text-xs text-brand-navy/70">
                        {g.variantId}
                      </td>
                      <td className="text-sm font-semibold text-brand-navy">
                        <EditableCell
                          editing={
                            editing?.kind === "title" &&
                            editing.productId === g.productId
                          }
                          status={cellStatus(`title:${g.productId}`)}
                          display={g.productTitle}
                          initial={g.productTitle}
                          type="text"
                          hint={t("edit.hint")}
                          onStart={() =>
                            setEditing({
                              kind: "title",
                              productId: g.productId,
                              current: g.productTitle,
                            })
                          }
                          onCommit={(v) =>
                            commitTitle(g.productId, g.productTitle, v)
                          }
                          onCancel={() => setEditing(null)}
                        />
                      </td>
                      <td className="text-xs text-brand-navy/80">
                        {g.variantTitle}
                      </td>
                      <td className="font-mono text-xs text-brand-navy/70">
                        <EditableCell
                          editing={
                            editing?.kind === "sku" &&
                            editing.variantId === g.variantId
                          }
                          status={cellStatus(`sku:${g.variantId}`)}
                          display={g.sku ?? "—"}
                          initial={g.sku ?? ""}
                          type="text"
                          hint={t("edit.hint")}
                          onStart={() =>
                            setEditing({
                              kind: "sku",
                              variantId: g.variantId,
                              current: g.sku,
                            })
                          }
                          onCommit={(v) => commitSku(g.variantId, g.sku, v)}
                          onCancel={() => setEditing(null)}
                        />
                      </td>
                      <td className="text-xs text-brand-navy/80">
                        {hasMany ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(g.variantId)}
                            className="inline-flex items-center gap-1.5 rounded transition hover:text-brand-burgundy"
                            aria-expanded={isOpen}
                          >
                            <span className="text-[9px] opacity-70">
                              {isOpen ? "▼" : "▶"}
                            </span>
                            {g.locations.length} Standorte
                          </button>
                        ) : (
                          (g.locations[0]?.locationName ?? "—")
                        )}
                      </td>
                      <td className="text-right text-base font-bold tabular-nums text-brand-navy">
                        {onHandEditable ? (
                          <EditableCell
                            editing={
                              editing?.kind === "onhand" &&
                              editing.variantId === g.variantId &&
                              editing.locationId === onHandLocId
                            }
                            status={cellStatus(
                              `onhand:${g.variantId}:${onHandLocId ?? "default"}`,
                            )}
                            display={g.onHand}
                            initial={String(g.onHand)}
                            type="number"
                            align="right"
                            hint={t("edit.hint")}
                            onStart={() =>
                              setEditing({
                                kind: "onhand",
                                variantId: g.variantId,
                                locationId: onHandLocId,
                                current: g.onHand,
                              })
                            }
                            onCommit={(v) =>
                              commitOnHand(g.variantId, onHandLocId, g.onHand, v)
                            }
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          g.onHand
                        )}
                      </td>
                      <td
                        className={`text-right text-base font-bold tabular-nums ${
                          g.reserved > 0 ? "text-amber-700" : "text-brand-navy/50"
                        }`}
                      >
                        {g.reserved}
                      </td>
                      <td
                        className={`text-right text-base font-bold tabular-nums ${
                          g.difference < 0
                            ? "text-brand-burgundy"
                            : g.difference > 0
                              ? "text-emerald-700"
                              : "text-brand-navy/50"
                        }`}
                      >
                        {g.difference}
                      </td>
                    </tr>
                    {hasMany &&
                      isOpen &&
                      g.locations.map((loc) => (
                        <tr
                          key={`${g.variantId}:${loc.locationId}`}
                          className="bg-zinc-50/60"
                        >
                          <td colSpan={5} />
                          <td className="pl-6 text-xs text-brand-navy/70">
                            {loc.locationName}
                          </td>
                          <td className="text-right text-sm font-semibold tabular-nums text-brand-navy/80">
                            <EditableCell
                              editing={
                                editing?.kind === "onhand" &&
                                editing.variantId === g.variantId &&
                                editing.locationId === loc.locationId
                              }
                              status={cellStatus(
                                `onhand:${g.variantId}:${loc.locationId}`,
                              )}
                              display={loc.onHand}
                              initial={String(loc.onHand)}
                              type="number"
                              align="right"
                              hint={t("edit.hint")}
                              onStart={() =>
                                setEditing({
                                  kind: "onhand",
                                  variantId: g.variantId,
                                  locationId: loc.locationId,
                                  current: loc.onHand,
                                })
                              }
                              onCommit={(v) =>
                                commitOnHand(
                                  g.variantId,
                                  loc.locationId,
                                  loc.onHand,
                                  v,
                                )
                              }
                              onCancel={() => setEditing(null)}
                            />
                          </td>
                          <td className="text-right text-xs text-brand-navy/30">
                            —
                          </td>
                          <td className="text-right text-xs text-brand-navy/30">
                            —
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })
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

function EditableCell({
  editing,
  status,
  display,
  initial,
  type,
  align,
  hint,
  onStart,
  onCommit,
  onCancel,
}: {
  editing: boolean;
  status: CellStatus;
  display: React.ReactNode;
  initial: string;
  type: "text" | "number";
  align?: "right";
  hint: string;
  onStart: () => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <InlineEditInput
        initial={initial}
        type={type}
        align={align}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }
  if (status !== "idle") {
    return (
      <span
        className={`-mx-1 inline-flex w-full items-center gap-1.5 px-1 ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        {align === "right" && <CellStatusIcon status={status} />}
        <span className={status === "saving" ? "opacity-60" : ""}>
          {display}
        </span>
        {align !== "right" && <CellStatusIcon status={status} />}
      </span>
    );
  }
  return (
    <button
      type="button"
      onDoubleClick={onStart}
      title={hint}
      className={`-mx-1 block w-full cursor-text rounded px-1 transition hover:bg-brand-navy/[0.06] ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {display}
    </button>
  );
}

function CellStatusIcon({ status }: { status: CellStatus }) {
  if (status === "saving") {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-navy/50"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
        />
      </svg>
    );
  }
  if (status === "success") {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 text-emerald-600"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m4.5 10.5 3.5 3.5 7.5-8" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg
        className="h-3.5 w-3.5 shrink-0 text-brand-burgundy"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
      </svg>
    );
  }
  return null;
}

function InlineEditInput({
  initial,
  type,
  align,
  onCommit,
  onCancel,
}: {
  initial: string;
  type: "text" | "number";
  align?: "right";
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const doneRef = useRef(false);
  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(val);
  };
  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };
  return (
    <input
      autoFocus
      type={type === "number" ? "number" : "text"}
      inputMode={type === "number" ? "numeric" : undefined}
      min={type === "number" ? 0 : undefined}
      step={type === "number" ? 1 : undefined}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
      className={`w-full min-w-[4rem] rounded border border-brand-navy bg-white px-1.5 py-1 text-xs font-normal text-brand-navy shadow-sm outline-none ring-2 ring-brand-navy/20 ${
        align === "right" ? "text-right tabular-nums" : ""
      }`}
    />
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
        className={`w-full min-w-[4.5rem] rounded border border-zinc-300 text-brand-navy bg-white px-2 py-1 text-xs shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy/20 ${
          align === "right" ? "text-right" : ""
        }`}
      />
    </th>
  );
}
