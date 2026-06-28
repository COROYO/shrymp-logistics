"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Barcode128 } from "@/app/_components/barcode-128";
import type { BinLabel } from "@/server/warehouse/bins";

type Cols = 2 | 3 | 4;

export function LabelSheet({ bins }: { bins: BinLabel[] }) {
  const t = useTranslations("binLabels");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(bins.map((b) => b.id)),
  );
  const [cols, setCols] = useState<Cols>(3);
  const [showName, setShowName] = useState(true);
  const [showZone, setShowZone] = useState(true);

  const toPrint = useMemo(
    () => bins.filter((b) => selected.has(b.id)),
    [bins, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (bins.length === 0) {
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

          <label className="flex items-center gap-2 text-sm text-brand-navy/80">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            {t("showName")}
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-navy/80">
            <input type="checkbox" checked={showZone} onChange={(e) => setShowZone(e.target.checked)} />
            {t("showZone")}
          </label>

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set(bins.map((b) => b.id)))}
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
              onClick={() => window.print()}
              disabled={toPrint.length === 0}
              className="btn-primary"
            >
              {t("print", { count: toPrint.length })}
            </button>
          </div>
        </div>

        <div className="mt-4 max-h-48 overflow-y-auto rounded-md border border-zinc-200">
          <ul className="divide-y divide-zinc-100 text-sm">
            {bins.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={selected.has(b.id)}
                  onChange={() => toggle(b.id)}
                />
                <span className="font-mono font-semibold text-brand-navy">{b.code}</span>
                <span className="text-brand-navy/60">{b.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div
        className="sc-label-grid grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {toPrint.map((b) => (
          <div
            key={b.id}
            className="sc-label flex flex-col items-center justify-center rounded-md border border-zinc-300 bg-white p-3 text-center"
          >
            {showName ? (
              <div className="w-full truncate text-sm font-semibold text-black">
                {b.name}
              </div>
            ) : null}
            {showZone && b.zone ? (
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                {b.zone}
              </div>
            ) : null}
            <Barcode128 value={b.code} height={46} moduleWidth={1.4} showValue className="mt-1" />
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          @page { margin: 8mm; }
          body { background: #fff; }
          .sc-label-grid { gap: 4mm; }
          .sc-label { break-inside: avoid; }
        }
      `}</style>
    </>
  );
}
