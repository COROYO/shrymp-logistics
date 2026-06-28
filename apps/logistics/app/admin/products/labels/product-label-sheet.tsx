"use client";

import { useMemo, useState, useTransition } from "react";
import { Dices, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { ProductLabel } from "@/app/_components/product-label";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import { barcodeToPngBlob } from "@/lib/barcode/code128-png";
import { createZip } from "@/lib/zip";
import type { VariantLabel } from "@/server/warehouse/product-labels";
import { assignSkuAction, generateSkuAction } from "./actions";

type Cols = 2 | 3 | 4;

/** The value encoded on a label's barcode: EAN/barcode, then SKU. */
function labelCode(l: VariantLabel): string {
  return (l.barcode || l.sku || "").trim();
}

function safeFileName(value: string): string {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "barcode"
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatPrice(cents: number | null, currency: string | null): string | null {
  if (cents == null) return null;
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currency ?? "EUR",
    }).format(cents / 100);
  } catch {
    return (cents / 100).toFixed(2);
  }
}

export function ProductLabelSheet({ labels }: { labels: VariantLabel[] }) {
  const t = useTranslations("productLabels");
  const [rows, setRows] = useState<VariantLabel[]>(labels);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(labels.map((l) => l.variantId)),
  );
  const [copies, setCopies] = useState(1);
  const [cols, setCols] = useState<Cols>(3);
  const [showPrice, setShowPrice] = useState(true);
  const [showSku, setShowSku] = useState(true);
  const [query, setQuery] = useState("");
  const [downloading, setDownloading] = useState(false);

  function applySku(variantId: string, sku: string) {
    setRows((prev) =>
      prev.map((r) => (r.variantId === variantId ? { ...r, sku } : r)),
    );
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (l) =>
        l.productTitle.toLowerCase().includes(q) ||
        l.variantTitle.toLowerCase().includes(q) ||
        (l.sku ?? "").toLowerCase().includes(q) ||
        (l.barcode ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const toPrint = useMemo(() => {
    const chosen = rows.filter((l) => selected.has(l.variantId));
    const n = Math.max(1, Math.min(20, copies));
    const expanded: Array<{ key: string; label: VariantLabel }> = [];
    for (const l of chosen) {
      for (let i = 0; i < n; i++) {
        expanded.push({ key: `${l.variantId}-${i}`, label: l });
      }
    }
    return expanded;
  }, [rows, selected, copies]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const downloadableCount = useMemo(
    () => rows.filter((l) => selected.has(l.variantId) && labelCode(l)).length,
    [rows, selected],
  );

  async function downloadOne(label: VariantLabel) {
    const code = labelCode(label);
    if (!code) return;
    const blob = await barcodeToPngBlob(code);
    if (!blob) return;
    downloadBlob(blob, `${safeFileName(label.sku || label.barcode || code)}.png`);
  }

  async function downloadSelected() {
    const chosen = rows
      .filter((l) => selected.has(l.variantId))
      .map((l) => ({ label: l, code: labelCode(l) }))
      .filter((x) => x.code.length > 0);

    if (chosen.length === 0) {
      dispatchAdminJobError({ title: t("title"), message: t("downloadEmpty") });
      return;
    }

    setDownloading(true);
    try {
      const used = new Set<string>();
      const entries: { name: string; data: Uint8Array<ArrayBuffer> }[] = [];
      for (const { label, code } of chosen) {
        const blob = await barcodeToPngBlob(code);
        if (!blob) continue;
        const base = safeFileName(label.sku || label.barcode || code);
        let name = `${base}.png`;
        for (let i = 2; used.has(name); i++) name = `${base}-${i}.png`;
        used.add(name);
        entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      }

      if (entries.length === 0) {
        dispatchAdminJobError({ title: t("title"), message: t("downloadEmpty") });
        return;
      }

      if (entries.length === 1) {
        const only = entries[0]!;
        downloadBlob(new Blob([only.data], { type: "image/png" }), only.name);
      } else {
        downloadBlob(createZip(entries), "barcodes.zip");
      }
      dispatchAdminJobSuccess({
        title: t("title"),
        message: t("downloadDone", { count: entries.length }),
      });
    } catch {
      dispatchAdminJobError({ title: t("title"), message: t("downloadFailed") });
    } finally {
      setDownloading(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card px-6 py-10 text-center text-sm text-brand-navy/60">
        {t("empty")}
      </div>
    );
  }

  return (
    <>
      <section className="card p-5 print:hidden">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
              {t("columns")}
            </span>
            <div className="mt-1 flex gap-1 rounded-md bg-zinc-100 p-1 text-sm">
              {([2, 3, 4] as Cols[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCols(c)}
                  className={`rounded px-3 py-1 font-semibold ${cols === c ? "bg-white text-brand-navy shadow-sm" : "text-brand-navy/60"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
              {t("copies")}
            </span>
            <input
              type="number"
              min={1}
              max={20}
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value) || 1)}
              className="input-sm mt-1 w-20"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-brand-navy/80">
            <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
            {t("showPrice")}
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-navy/80">
            <input type="checkbox" checked={showSku} onChange={(e) => setShowSku(e.target.checked)} />
            {t("showSku")}
          </label>

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set(rows.map((l) => l.variantId)))}
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 hover:text-brand-burgundy"
            >
              {t("selectAll")}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 hover:text-brand-burgundy"
            >
              {t("selectNone")}
            </button>
            <button
              type="button"
              onClick={downloadSelected}
              disabled={downloading || downloadableCount === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-navy/70 transition hover:border-brand-navy hover:text-brand-navy disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {downloading ? "…" : t("downloadBarcodes", { count: downloadableCount })}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={toPrint.length === 0}
              className="btn-primary"
            >
              {t("print", { count: toPrint.length })}
            </button>
          </div>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="input-sm mt-4 w-72"
        />

        <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-zinc-200">
          <ul className="divide-y divide-zinc-100 text-sm">
            {visible.map((l) => (
              <li key={l.variantId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(l.variantId)}
                  onChange={() => toggle(l.variantId)}
                />
                <span className="min-w-0 flex-1 truncate text-brand-navy">
                  {l.productTitle}
                  {l.variantTitle && l.variantTitle !== "Default Title" ? (
                    <span className="text-brand-navy/50"> · {l.variantTitle}</span>
                  ) : null}
                  {l.barcode ? (
                    <span className="ml-2 font-mono text-[11px] text-brand-navy/40">
                      EAN {l.barcode}
                    </span>
                  ) : null}
                </span>
                <SkuEditor
                  variantId={l.variantId}
                  sku={l.sku}
                  onAssigned={(sku) => applySku(l.variantId, sku)}
                />
                <button
                  type="button"
                  onClick={() => downloadOne(l)}
                  disabled={!labelCode(l)}
                  title={t("downloadBarcode")}
                  aria-label={t("downloadBarcode")}
                  className="rounded-md border border-zinc-300 px-2 py-1.5 text-brand-navy/70 transition hover:border-brand-burgundy hover:text-brand-burgundy disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div
        className="sc-label-grid grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {toPrint.map(({ key, label }) => (
          <ProductLabel
            key={key}
            productTitle={label.productTitle}
            variantTitle={label.variantTitle}
            sku={label.sku}
            barcode={label.barcode}
            priceLabel={formatPrice(label.priceCents, label.currency)}
            showPrice={showPrice}
            showSku={showSku}
          />
        ))}
      </div>

      <style>{`
        @media print {
          @page { margin: 8mm; }
          body { background: #fff; }
          .sc-label-grid { gap: 4mm; }
          .sc-product-label { break-inside: avoid; }
        }
      `}</style>
    </>
  );
}

function SkuEditor({
  variantId,
  sku,
  onAssigned,
}: {
  variantId: string;
  sku: string | null;
  onAssigned: (sku: string) => void;
}) {
  const t = useTranslations("productLabels");
  const [value, setValue] = useState(sku ?? "");
  const [pending, startTransition] = useTransition();
  const dirty = value.trim() !== (sku ?? "");

  function transErr(code: string): string {
    return t.has(`skuErrors.${code}`) ? t(`skuErrors.${code}`) : code;
  }

  function save() {
    const next = value.trim();
    if (!next || !dirty) return;
    startTransition(async () => {
      const res = await assignSkuAction(variantId, next);
      if (res.ok) {
        setValue(res.sku);
        onAssigned(res.sku);
        dispatchAdminJobSuccess({ title: t("title"), message: t("skuSaved", { sku: res.sku }) });
      } else {
        dispatchAdminJobError({ title: t("title"), message: transErr(res.error) });
      }
    });
  }

  function generate() {
    startTransition(async () => {
      const res = await generateSkuAction(variantId);
      if (res.ok) {
        setValue(res.sku);
        onAssigned(res.sku);
        dispatchAdminJobSuccess({ title: t("title"), message: t("skuGenerated", { sku: res.sku }) });
      } else {
        dispatchAdminJobError({ title: t("title"), message: transErr(res.error) });
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        placeholder={t("skuPlaceholder")}
        className="input-sm w-36 font-mono text-xs"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty || !value.trim()}
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-[11px] font-semibold text-brand-navy/70 transition hover:border-brand-navy hover:text-brand-navy disabled:opacity-40"
      >
        {pending ? "…" : t("skuSave")}
      </button>
      <button
        type="button"
        onClick={generate}
        disabled={pending}
        title={t("skuGenerate")}
        aria-label={t("skuGenerate")}
        className="rounded-md border border-zinc-300 px-2 py-1.5 text-brand-navy/70 transition hover:border-brand-burgundy hover:text-brand-burgundy disabled:opacity-40"
      >
        <Dices className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
