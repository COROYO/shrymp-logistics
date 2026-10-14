"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SlipBlockedMessage } from "@/app/lager/_slip/slip-blocked";
import { SlipBody } from "@/app/lager/_slip/slip-body";
import { SlipPaginator } from "@/app/lager/_slip/slip-paginator";
import { PrintTrigger } from "@/app/lager/picking/[orderId]/print/print-trigger";
import { parseOrderIdsFromHash } from "@/lib/print-slips-ids";
import {
  PRINT_MOUNT_LIMIT,
  PRINT_SLIP_CHUNK_SIZE,
  type PrintSlipChunkResponse,
} from "@/lib/print-slip-chunk";
import type { SlipAssignmentBlockReason } from "@/app/lager/_slip/types";
import type { SlipViewData } from "@/app/lager/_slip/types";

type BlockedSlip = {
  orderId: string;
  reason: SlipAssignmentBlockReason;
  minDays: number;
};

type FailedSlip = { orderId: string };

const CHUNK_FETCH_TIMEOUT_MS = 55_000;
const CHUNK_RETRIES = 3;

/**
 * Bulk packing slips: resolve a short `?job=` URL (or `#ids=` / `?ids=`),
 * then generate in sequential HTTP chunks.
 */
export function BulkPrintClient({
  jobId,
  initialIds,
}: {
  jobId?: string;
  initialIds: string[];
}) {
  const t = useTranslations("printSlips");
  const [orderIds, setOrderIds] = useState<string[]>(initialIds);
  const [phase, setPhase] = useState<"resolve" | "generate" | "done" | "empty">(
    "resolve",
  );
  const [fatal, setFatal] = useState<"forbidden" | "not_found" | null>(null);
  const [current, setCurrent] = useState(0);
  const [slips, setSlips] = useState<SlipViewData[]>([]);
  const [blocked, setBlocked] = useState<BlockedSlip[]>([]);
  const [failed, setFailed] = useState<FailedSlip[]>([]);
  const [waveIndex, setWaveIndex] = useState(0);
  const [printNonce, setPrintNonce] = useState(0);

  const initialKey = initialIds.join(",");

  useEffect(() => {
    const idsFromQuery = initialKey.length > 0 ? initialKey.split(",") : [];
    let cancelled = false;

    async function run() {
      try {
        const resolved = await resolveJob(jobId, idsFromQuery);
        if (cancelled) return;
        if (!resolved.ok) {
          if (resolved.error === "empty") {
            setPhase("empty");
            return;
          }
          setFatal(resolved.error);
          return;
        }

        setOrderIds(resolved.orderIds);
        if (resolved.orderIds.length === 0) {
          setPhase("empty");
          return;
        }
        if (resolved.jobId !== jobId) {
          window.history.replaceState(
            null,
            "",
            `/lager/print-slips?job=${encodeURIComponent(resolved.jobId)}`,
          );
        }
        setPhase("generate");

        const accSlips: SlipViewData[] = [];
        const accBlocked: BlockedSlip[] = [];
        const accFailed: FailedSlip[] = [];
        let offset = 0;

        while (offset < resolved.orderIds.length) {
          if (cancelled) return;
          const remaining = resolved.orderIds.length - offset;
          const limit = Math.min(PRINT_SLIP_CHUNK_SIZE, remaining);
          let chunk: PrintSlipChunkResponse;
          try {
            chunk = await fetchSlipChunk(resolved.jobId, offset, limit);
          } catch {
            await generateOneByOne(
              resolved.jobId,
              resolved.orderIds,
              offset,
              limit,
              accSlips,
              accBlocked,
              accFailed,
              () => cancelled,
              (n) => {
                if (!cancelled) setCurrent(n);
              },
            );
            offset += limit;
            continue;
          }

          if (cancelled) return;
          applyChunk(chunk, accSlips, accBlocked, accFailed);
          offset = chunk.nextOffset;
          setCurrent(offset);
        }

        if (cancelled) return;
        setSlips(accSlips);
        setBlocked(accBlocked);
        setFailed(accFailed);
        setPhase("done");
      } catch {
        if (!cancelled) setFatal("not_found");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [jobId, initialKey]);

  if (fatal === "forbidden") {
    return <StatusCard title={t("forbidden")} />;
  }
  if (fatal === "not_found") {
    return <StatusCard title={t("jobNotFound")} />;
  }
  if (phase === "empty") {
    return <StatusCard title={t("empty")} />;
  }

  const total = orderIds.length;
  const generating = phase === "generate" || phase === "resolve";
  const waveCount = Math.max(1, Math.ceil(slips.length / PRINT_MOUNT_LIMIT));
  const waveStart = waveIndex * PRINT_MOUNT_LIMIT;
  const waveSlips = slips.slice(waveStart, waveStart + PRINT_MOUNT_LIMIT);
  const readyToPrint = phase === "done" && waveSlips.length > 0;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 18mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      {generating ? (
        <div className="print:hidden sticky top-0 z-20 rounded-lg border border-brand-navy/10 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
            {t("eyebrow")}
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-brand-navy">
            {total > 0 ? t("generating", { current, total }) : t("preparing")}
          </h1>
          {total > 0 ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-navy/10">
              <div
                className="h-full bg-brand-burgundy transition-[width] duration-200"
                style={{
                  width: `${Math.round((current / Math.max(total, 1)) * 100)}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === "done" && slips.length === 0 ? (
        <div className="print:hidden mx-auto mt-16 max-w-lg px-6">
          <p className="eyebrow text-brand-burgundy">{t("eyebrow")}</p>
          <h1 className="h-display mt-2 text-2xl text-brand-navy">
            {t("noneGenerated")}
          </h1>
        </div>
      ) : null}

      {phase === "done" && slips.length > 0 && waveCount > 1 ? (
        <div className="print:hidden sticky top-0 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-navy/10 bg-white px-4 py-3 shadow-sm">
          <p className="text-sm font-medium text-brand-navy">
            {t("wave", {
              current: waveIndex + 1,
              total: waveCount,
              count: waveSlips.length,
            })}
          </p>
          {waveIndex < waveCount - 1 ? (
            <button
              type="button"
              className="rounded-md bg-brand-burgundy px-3 py-1.5 text-sm font-semibold text-white"
              onClick={() => {
                setWaveIndex((n) => n + 1);
                setPrintNonce((n) => n + 1);
              }}
            >
              {t("nextWave")}
            </button>
          ) : null}
        </div>
      ) : null}

      {blocked.length > 0 ? (
        <div className="mx-auto max-w-[210mm] space-y-6 p-6 print:hidden">
          {blocked.map((err) => (
            <SlipBlockedMessage
              key={err.orderId}
              orderId={err.orderId}
              reason={err.reason}
              minDays={err.minDays}
            />
          ))}
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="print:hidden mx-auto max-w-[210mm] px-6 pb-4 text-sm text-brand-burgundy">
          {failed.map((f) => (
            <p key={f.orderId}>{t("failed", { id: f.orderId })}</p>
          ))}
        </div>
      ) : null}

      {readyToPrint ? <SlipPaginator key={`pages-${printNonce}`} /> : null}
      {waveSlips.map((slip, idx) => (
        <SlipBody
          key={slip.orderId}
          data={slip}
          pageBreakAfter={idx < waveSlips.length - 1}
        />
      ))}
      {readyToPrint ? <PrintTrigger key={`print-${printNonce}`} /> : null}
    </>
  );
}

function StatusCard({ title }: { title: string }) {
  const t = useTranslations("printSlips");
  return (
    <div className="mx-auto mt-16 max-w-lg px-6">
      <p className="eyebrow text-brand-burgundy">{t("eyebrow")}</p>
      <h1 className="h-display mt-2 text-2xl text-brand-navy">{title}</h1>
    </div>
  );
}

function applyChunk(
  chunk: PrintSlipChunkResponse,
  slips: SlipViewData[],
  blocked: BlockedSlip[],
  failed: FailedSlip[],
): void {
  for (const item of chunk.items) {
    if (item.ok) {
      slips.push(item.data);
    } else if ("blocked" in item && item.blocked) {
      blocked.push(item.blocked);
    } else {
      failed.push({ orderId: item.orderId });
    }
  }
}

async function generateOneByOne(
  jobId: string,
  orderIds: string[],
  offset: number,
  limit: number,
  slips: SlipViewData[],
  blocked: BlockedSlip[],
  failed: FailedSlip[],
  isCancelled: () => boolean,
  onProgress: (current: number) => void,
): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (isCancelled()) return;
    const id = orderIds[offset + i];
    if (!id) return;
    try {
      const chunk = await fetchSlipChunk(jobId, offset + i, 1);
      applyChunk(chunk, slips, blocked, failed);
    } catch {
      failed.push({ orderId: id });
    }
    onProgress(offset + i + 1);
  }
}

type ResolveJobResult =
  | { ok: true; jobId: string; orderIds: string[] }
  | { ok: false; error: "forbidden" | "not_found" | "empty" };

async function resolveJob(
  jobId: string | undefined,
  initialIds: string[],
): Promise<ResolveJobResult> {
  if (jobId) {
    return loadJob(jobId);
  }
  const ids =
    initialIds.length > 0
      ? initialIds
      : parseOrderIdsFromHash(window.location.hash);
  if (ids.length === 0) return { ok: false, error: "empty" };
  return createJob(ids);
}

async function loadJob(jobId: string): Promise<ResolveJobResult> {
  const res = await fetch(`/api/lager/print-jobs/${encodeURIComponent(jobId)}`, {
    credentials: "same-origin",
  });
  if (res.status === 401) return { ok: false, error: "forbidden" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (!res.ok) return { ok: false, error: "not_found" };
  const body = (await res.json()) as { orderIds?: unknown };
  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.map((v) => String(v))
    : [];
  return { ok: true, jobId, orderIds };
}

async function createJob(ids: string[]): Promise<ResolveJobResult> {
  const res = await fetch("/api/lager/print-jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (res.status === 401) return { ok: false, error: "forbidden" };
  if (!res.ok) return { ok: false, error: "empty" };
  const body = (await res.json()) as { jobId?: unknown };
  if (typeof body.jobId !== "string" || !body.jobId) {
    return { ok: false, error: "empty" };
  }
  return loadJob(body.jobId);
}

async function fetchSlipChunk(
  jobId: string,
  offset: number,
  limit: number,
): Promise<PrintSlipChunkResponse> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `/api/lager/print-jobs/${encodeURIComponent(jobId)}/slips`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset, limit }),
          signal: AbortSignal.timeout(CHUNK_FETCH_TIMEOUT_MS),
        },
      );
      if (res.status === 401) throw new Error("forbidden");
      if (res.status === 404) throw new Error("not_found");
      if (!res.ok) throw new Error(`chunk_http_${res.status}`);
      return (await res.json()) as PrintSlipChunkResponse;
    } catch (e) {
      lastErr = e;
      if (attempt < CHUNK_RETRIES) {
        await sleep(400 * attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("chunk_failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
