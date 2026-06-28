"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CameraScanner } from "@/app/lager/scan/camera-scanner";
import {
  adjustPickSlotAction,
  cancelPickRunAction,
  completePickingAction,
  scanPickAction,
} from "../actions";

export type RunSlotView = {
  slot: number;
  orderId: string;
  orderName: string;
  express: boolean;
};

export type RunLineSlotView = {
  slot: number;
  orderId: string;
  qty: number;
  picked: number;
};

export type RunLineView = {
  variantId: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  binCode: string | null;
  binName: string | null;
  totalQty: number;
  slots: RunLineSlotView[];
};

// One stable colour per cart slot — makes "put into slot 3" unmistakable.
const SLOT_COLORS = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-teal-600",
  "bg-indigo-600",
  "bg-orange-600",
  "bg-pink-600",
  "bg-lime-600",
  "bg-cyan-600",
  "bg-fuchsia-600",
];

function slotColor(slot: number): string {
  return SLOT_COLORS[(slot - 1) % SLOT_COLORS.length];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function matchLine(lines: RunLineView[], code: string): RunLineView | null {
  const c = code.trim();
  if (!c) return null;
  const byBarcode = lines.find((l) => l.barcode && l.barcode === c);
  if (byBarcode) return byBarcode;
  const lc = c.toLowerCase();
  return lines.find((l) => l.sku && l.sku.toLowerCase() === lc) ?? null;
}

type PickErr = {
  id: number;
  type: "wrong_item" | "over_pick" | "sync";
  code?: string;
  title?: string;
};

type PutHint = { slot: number; orderName: string; title: string };

export function RunPickClient({
  runId,
  slots,
  lines: initial,
}: {
  runId: string;
  slots: RunSlotView[];
  lines: RunLineView[];
}) {
  const t = useTranslations("pickRun");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const errSeq = useRef(0);

  const [lines, setLines] = useState<RunLineView[]>(initial);
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [put, setPut] = useState<PutHint | null>(null);
  const [errors, setErrors] = useState<PickErr[]>([]);
  const [busy, setBusy] = useState(false);

  const orderNameBySlot = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of slots) m.set(s.slot, s.orderName);
    return m;
  }, [slots]);

  const totals = useMemo(() => {
    let picked = 0;
    let total = 0;
    for (const l of lines) {
      for (const s of l.slots) {
        picked += Math.min(s.picked, s.qty);
        total += s.qty;
      }
    }
    return { picked, total, complete: total > 0 && picked >= total };
  }, [lines]);

  function pushError(e: Omit<PickErr, "id">) {
    errSeq.current += 1;
    setErrors((prev) => [{ ...e, id: errSeq.current }, ...prev].slice(0, 5));
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(120);
    }
  }

  function applyLocal(variantId: string, slot: number, delta: number) {
    setLines((prev) =>
      prev.map((l) =>
        l.variantId !== variantId
          ? l
          : {
              ...l,
              slots: l.slots.map((s) =>
                s.slot === slot
                  ? { ...s, picked: clamp(s.picked + delta, 0, s.qty) }
                  : s,
              ),
            },
      ),
    );
  }

  async function persistScan(code: string, variantId: string, slot: number) {
    try {
      const res = await scanPickAction(runId, code);
      if (!res.ok) {
        pushError({ type: "sync" });
        return;
      }
      const r = res.result;
      if (!r.ok && r.reason === "over_pick") {
        applyLocal(variantId, slot, -1);
        pushError({ type: "over_pick", code });
      } else if (!r.ok && r.reason === "not_picking") {
        router.refresh();
      }
    } catch {
      pushError({ type: "sync" });
    }
  }

  function handleScan(code: string) {
    const c = code.trim();
    if (!c) return;
    const line = matchLine(lines, c);
    if (!line) {
      pushError({ type: "wrong_item", code: c });
      return;
    }
    const slot = line.slots.find((s) => s.picked < s.qty);
    if (!slot) {
      pushError({ type: "over_pick", code: c, title: line.title });
      return;
    }
    applyLocal(line.variantId, slot.slot, +1);
    setPut({
      slot: slot.slot,
      orderName: orderNameBySlot.get(slot.slot) ?? "",
      title: line.title,
    });
    void persistScan(c, line.variantId, slot.slot);
  }

  function manualAdjust(variantId: string, slot: number, delta: number) {
    applyLocal(variantId, slot, delta);
    void adjustPickSlotAction(runId, variantId, slot, delta);
  }

  async function handleComplete() {
    setBusy(true);
    const res = await completePickingAction(runId);
    setBusy(false);
    if (res.ok) {
      router.push(`/lager/run/${runId}/pack`);
    } else {
      pushError({ type: "sync" });
      router.refresh();
    }
  }

  async function handleCancel() {
    if (!confirm(t("cancelConfirm"))) return;
    setBusy(true);
    const res = await cancelPickRunAction(runId);
    setBusy(false);
    if (res.ok) router.push("/lager/picking");
  }

  const pct = totals.total > 0 ? Math.round((totals.picked / totals.total) * 100) : 0;

  return (
    <div className="pb-44">
      <header className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1 className="mt-1 text-2xl font-bold text-brand-navy">
              {t("title", { count: slots.length })}
            </h1>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="btn-ghost shrink-0 disabled:opacity-50"
          >
            {t("cancel")}
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-brand-navy/70">
              {t("progress")}
            </span>
            <span className="tabular-nums font-bold text-brand-navy">
              {totals.picked} / {totals.total}
            </span>
          </div>
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-zinc-200">
            <div
              className={`h-full rounded-full transition-all ${
                totals.complete ? "bg-emerald-500" : "bg-brand-burgundy"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <span
              key={s.slot}
              className={`inline-flex items-center gap-1.5 rounded-full ${slotColor(
                s.slot,
              )} px-2.5 py-1 text-xs font-semibold text-white`}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 font-bold">
                {s.slot}
              </span>
              <span className="font-mono">{s.orderName}</span>
              {s.express ? <span aria-hidden>⚡</span> : null}
            </span>
          ))}
        </div>
      </header>

      {errors.length > 0 ? (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-red-700">
              {t("errorsTitle")}
            </span>
            <button
              type="button"
              onClick={() => setErrors([])}
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-red-700/70 hover:text-red-800"
            >
              {t("clearErrors")}
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-red-800">
            {errors.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                {e.code ? (
                  <span className="font-mono text-xs">{e.code}</span>
                ) : null}
                <span>
                  {e.type === "wrong_item"
                    ? t("errWrongItem")
                    : e.type === "over_pick"
                      ? t("errOverPick", { title: e.title ?? "" })
                      : t("errSync")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="mt-4 space-y-2">
        {lines.map((line) => {
          const picked = line.slots.reduce(
            (n, s) => n + Math.min(s.picked, s.qty),
            0,
          );
          const done = picked >= line.totalQty;
          return (
            <li
              key={line.variantId}
              className={`card p-3 transition ${done ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-3">
                {line.binCode ? (
                  <span className="grid shrink-0 place-items-center rounded-md bg-brand-cream px-2 py-1 text-center font-mono text-sm font-bold text-brand-navy">
                    {line.binCode}
                  </span>
                ) : (
                  <span className="grid shrink-0 place-items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-center text-[10px] font-semibold text-amber-700">
                    {t("binNone")}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-tight text-brand-navy">
                    {line.title}
                  </div>
                  <div className="truncate text-xs text-brand-navy/60">
                    {line.variantTitle ? `${line.variantTitle} · ` : ""}
                    {line.sku ? `SKU ${line.sku}` : t("noCode")}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`tabular-nums text-lg font-bold ${
                      done ? "text-emerald-600" : "text-brand-navy"
                    }`}
                  >
                    {picked}/{line.totalQty}
                  </span>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {line.slots.map((s) => {
                  const slotDone = s.picked >= s.qty;
                  return (
                    <div
                      key={s.slot}
                      className={`flex items-center gap-1 rounded-md ${slotColor(
                        s.slot,
                      )} px-1 py-0.5 text-white ${slotDone ? "opacity-50" : ""}`}
                    >
                      <span className="grid h-5 w-5 place-items-center rounded bg-white/25 text-xs font-bold">
                        {s.slot}
                      </span>
                      <button
                        type="button"
                        onClick={() => manualAdjust(line.variantId, s.slot, -1)}
                        disabled={s.picked === 0}
                        className="grid h-6 w-6 place-items-center rounded text-base font-bold hover:bg-white/20 disabled:opacity-30"
                        aria-label="-1"
                      >
                        −
                      </button>
                      <span className="min-w-[2.2rem] text-center text-xs font-bold tabular-nums">
                        {s.picked}/{s.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => manualAdjust(line.variantId, s.slot, +1)}
                        disabled={s.picked >= s.qty}
                        className="grid h-6 w-6 place-items-center rounded text-base font-bold hover:bg-white/20 disabled:opacity-30"
                        aria-label="+1"
                      >
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6">
        <button
          type="button"
          onClick={handleComplete}
          disabled={!totals.complete || busy}
          className="w-full rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          {totals.complete ? t("complete") : t("completeLocked")}
        </button>
        <p className="mt-2 text-center text-xs text-brand-navy/50">
          {t("completeHint")}
        </p>
      </div>

      {/* Fixed bottom scanner bar — thumb-reachable, stays clear of the nav. */}
      <div className="fixed inset-x-0 bottom-0 left-0 z-20 border-t border-zinc-200 bg-white/95 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur md:left-60">
        {put ? (
          <div
            className={`mb-2 flex items-center gap-3 rounded-md ${slotColor(
              put.slot,
            )} px-3 py-2 text-white`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/25 text-lg font-bold">
              {put.slot}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
                {t("putInto", { order: put.orderName })}
              </div>
              <div className="truncate text-sm font-semibold">{put.title}</div>
            </div>
          </div>
        ) : null}

        {camera ? (
          <div className="mb-2">
            <CameraScanner onDetect={handleScan} onError={() => setCamera(false)} />
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleScan(value);
            setValue("");
            inputRef.current?.focus();
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder={t("scanPlaceholder")}
            className="input-sm h-12 flex-1 font-mono text-base"
          />
          <button
            type="button"
            onClick={() => setCamera((v) => !v)}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-brand-navy/20 text-brand-navy"
            aria-label={camera ? t("cameraStop") : t("cameraStart")}
          >
            <CameraGlyph on={camera} />
          </button>
        </form>
      </div>
    </div>
  );
}

function CameraGlyph({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <path
        d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-1.5h7l1 1.5h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <circle
        cx="12"
        cy="13"
        r="3.2"
        stroke="currentColor"
        strokeWidth={1.6}
        fill={on ? "currentColor" : "none"}
      />
    </svg>
  );
}
