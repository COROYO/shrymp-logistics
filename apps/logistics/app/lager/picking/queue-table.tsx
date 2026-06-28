"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { OrderNoteIcon } from "@/app/_components/order-note-icon";
import { bulkConfirmPackingAction } from "../packing/actions";
import { createPickRunAction } from "../run/actions";

export type QueueRow = {
  id: string;
  name: string;
  createdIso: string;
  itemCount: number;
  positionCount: number;
  city: string | null;
  tags: string[];
  internal_status: "SHIP" | "PICKING";
  isExpress: boolean;
  customerNote: string | null;
};

type Failure = { orderId: string; error: string };

export function QueueTable({ rows }: { rows: QueueRow[] }) {
  const t = useTranslations("picking.queue");
  const tBulk = useTranslations("picking.queue.bulk");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{
    successCount: number;
    failures: Failure[];
  } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
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
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function handlePrintSlips() {
    if (selectedIds.length === 0) return;
    const url = `/lager/print-slips?ids=${selectedIds.join(",")}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleStartRun() {
    if (selectedIds.length === 0) return;
    setRunError(null);
    setResult(null);
    start(async () => {
      const res = await createPickRunAction(selectedIds);
      if (res.ok) {
        router.push(`/lager/run/${res.runId}`);
      } else {
        setRunError(res.error);
      }
    });
  }

  function handleMarkPacked() {
    if (selectedIds.length === 0) return;
    if (!confirm(tBulk("confirmMark", { count: selectedIds.length }))) return;
    setResult(null);
    start(async () => {
      const res = await bulkConfirmPackingAction(selectedIds);
      const failures = res.results
        .filter((r) => !r.ok)
        .map((r) => ({ orderId: r.orderId, error: r.error ?? "unknown" }));
      setResult({ successCount: res.successCount, failures });
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 || result ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {selected.size > 0 ? (
              <>
                <span className="text-sm font-semibold text-brand-navy">
                  {tBulk("selected", { count: selected.size })}
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={pending}
                  className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60 hover:text-brand-burgundy disabled:opacity-50"
                >
                  {tBulk("clear")}
                </button>
              </>
            ) : null}
            {result ? (
              <span className="text-sm text-brand-navy/70">
                {result.failures.length === 0
                  ? tBulk("successAll", { count: result.successCount })
                  : tBulk("successPartial", {
                      ok: result.successCount,
                      fail: result.failures.length,
                    })}
                {result.failures.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowErrors((v) => !v)}
                    className="ml-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy hover:underline"
                  >
                    {tBulk("showErrors")}
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
          {selected.size > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleStartRun}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? tBulk("starting") : tBulk("startRun", { count: selected.size })}
              </button>
              <button
                type="button"
                onClick={handlePrintSlips}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-md border border-brand-navy/30 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-navy/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {tBulk("printSlips", { count: selected.size })}
              </button>
              <button
                type="button"
                onClick={handleMarkPacked}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-md bg-brand-burgundy px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-burgundy-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? tBulk("marking") : tBulk("markPacked")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {runError ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-4 py-3 text-sm text-brand-burgundy-dark">
          {tBulk("runError")}
          {runError === "no_eligible" ? ` ${tBulk("runNoEligible")}` : ` (${runError})`}
        </div>
      ) : null}

      {showErrors && result && result.failures.length > 0 ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-4 py-3 text-xs">
          <ul className="space-y-1 font-mono text-brand-burgundy-dark">
            {result.failures.map((f) => (
              <li key={f.orderId}>
                <span className="font-bold">{f.orderId}</span>: {f.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
                <th>{t("table.created")}</th>
                <th>{t("table.items")}</th>
                <th>{t("table.city")}</th>
                <th>{t("table.tags")}</th>
                <th>{t("table.status")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const cta =
                  o.internal_status === "PICKING"
                    ? t("ctaContinue")
                    : t("ctaStart");
                const isSel = selected.has(o.id);
                return (
                  <tr
                    key={o.id}
                    className={
                      o.isExpress
                        ? "bg-brand-burgundy-soft/40"
                        : isSel
                          ? "bg-brand-navy/5"
                          : undefined
                    }
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
                      {o.createdIso
                        ? new Date(o.createdIso).toLocaleString("de-DE", {
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
                    <td>
                      <span
                        className={
                          o.internal_status === "PICKING"
                            ? "chip chip-violet"
                            : "chip chip-emerald"
                        }
                      >
                        {o.internal_status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Link
                        href={`/lager/picking/${o.id}/slip`}
                        target="_blank"
                        className="mr-4 text-[11px] font-semibold uppercase tracking-wide text-brand-navy/50 hover:text-brand-burgundy"
                        title={t("linkSlip")}
                      >
                        {t("linkSlip")}
                      </Link>

                      <Link
                        href={`/lager/picking/${o.id}`}
                        className="text-sm font-semibold text-brand-burgundy hover:text-brand-burgundy-dark"
                      >
                        {cta}
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
