"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { PickScanItem } from "@/server/warehouse/pick-scan";
import { CameraScanner } from "@/app/lager/scan/camera-scanner";

type Progress = Record<string, number>; // variantId → scanned count

type PickError = {
  id: number;
  type: "wrong_item" | "over_pick";
  code: string;
  title?: string;
  at: number;
};

function matchItem(items: PickScanItem[], code: string): PickScanItem | null {
  const c = code.trim();
  if (!c) return null;
  const byBarcode = items.find((i) => i.barcode && i.barcode === c);
  if (byBarcode) return byBarcode;
  const lc = c.toLowerCase();
  const bySku = items.find((i) => i.sku && i.sku.toLowerCase() === lc);
  return bySku ?? null;
}

export function PickScanVerifier({ items }: { items: PickScanItem[] }) {
  const t = useTranslations("pickScan");
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [errors, setErrors] = useState<PickError[]>([]);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const errorSeq = useRef(0);

  const totals = useMemo(() => {
    const expected = items.reduce((s, i) => s + i.qty, 0);
    const picked = items.reduce(
      (s, i) => s + Math.min(i.qty, progress[i.variantId] ?? 0),
      0,
    );
    return { expected, picked, complete: expected > 0 && picked >= expected };
  }, [items, progress]);

  function pushError(e: Omit<PickError, "id" | "at">) {
    errorSeq.current += 1;
    const entry: PickError = { ...e, id: errorSeq.current, at: Date.now() };
    setErrors((prev) => [entry, ...prev].slice(0, 6));
    // Short vibration on supported devices — tactile "wrong" signal.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(120);
    }
  }

  function handleScan(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    const item = matchItem(items, trimmed);
    if (!item) {
      pushError({ type: "wrong_item", code: trimmed });
      return;
    }
    const current = progress[item.variantId] ?? 0;
    if (current >= item.qty) {
      pushError({ type: "over_pick", code: trimmed, title: item.title });
      return;
    }
    setProgress((prev) => ({ ...prev, [item.variantId]: current + 1 }));
  }

  function adjust(variantId: string, delta: number, max: number) {
    setProgress((prev) => {
      const next = Math.max(0, Math.min(max, (prev[variantId] ?? 0) + delta));
      return { ...prev, [variantId]: next };
    });
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 className="mt-1 text-sm font-semibold text-brand-navy">
            {t("title")}
          </h2>
        </div>
        <div
          className={`rounded-md px-3 py-1.5 text-sm font-bold tabular-nums ${
            totals.complete
              ? "bg-emerald-100 text-emerald-800"
              : "bg-zinc-100 text-brand-navy"
          }`}
        >
          {totals.picked} / {totals.expected}
        </div>
      </div>

      <div className="space-y-4 p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleScan(value);
            setValue("");
            inputRef.current?.focus();
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder={t("placeholder")}
            className="input-sm h-11 flex-1 min-w-[12rem] font-mono"
          />
          <button type="submit" className="btn-primary h-11">
            {t("check")}
          </button>
          <button
            type="button"
            onClick={() => setCamera((v) => !v)}
            className="btn-ghost h-11"
          >
            {camera ? t("cameraStop") : t("cameraStart")}
          </button>
        </form>

        {camera ? (
          <CameraScanner onDetect={handleScan} onError={() => setCamera(false)} />
        ) : null}

        {errors.length > 0 ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-red-700">
                {t("errorsTitle")}
              </span>
              <button
                type="button"
                onClick={() => setErrors([])}
                className="text-[11px] font-semibold uppercase tracking-[0.1em] text-red-700/70 hover:text-red-800"
              >
                {t("clear")}
              </button>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-red-800">
              {errors.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className="font-mono text-xs">{e.code}</span>
                  <span>
                    {e.type === "wrong_item"
                      ? t("errWrongItem")
                      : t("errOverPick", { title: e.title ?? "" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ul className="divide-y divide-zinc-100">
          {items.map((item) => {
            const picked = Math.min(item.qty, progress[item.variantId] ?? 0);
            const done = picked >= item.qty;
            return (
              <li
                key={item.variantId}
                className={`flex items-center gap-3 py-3 ${done ? "opacity-60" : ""}`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    done ? "bg-emerald-500 text-white" : "bg-zinc-200 text-brand-navy/70"
                  }`}
                  aria-hidden
                >
                  {done ? "✓" : picked}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-brand-navy">
                    {item.title}
                  </div>
                  <div className="truncate text-xs text-brand-navy/60">
                    {item.binCode ? (
                      <span className="font-mono font-semibold text-brand-navy/80">
                        {item.binCode}
                      </span>
                    ) : null}
                    {item.binCode ? " · " : ""}
                    {item.sku ? `SKU ${item.sku}` : t("noCode")}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="tabular-nums font-bold text-brand-navy">
                    {picked}/{item.qty}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjust(item.variantId, -1, item.qty)}
                      disabled={picked === 0}
                      className="h-7 w-7 rounded border border-zinc-300 text-brand-navy/70 transition hover:border-brand-navy disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="-1"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => adjust(item.variantId, +1, item.qty)}
                      disabled={picked >= item.qty}
                      className="h-7 w-7 rounded border border-zinc-300 text-brand-navy/70 transition hover:border-brand-navy disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="+1"
                    >
                      +
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {totals.complete ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
            {t("allDone")}
          </div>
        ) : null}
      </div>
    </section>
  );
}
