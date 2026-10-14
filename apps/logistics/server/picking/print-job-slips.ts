import "server-only";
import { log } from "@/lib/logger";
import {
  PRINT_SLIP_CHUNK_SIZE,
  printJobChunkRange,
  type PrintSlipChunkItem,
  type PrintSlipChunkResponse,
} from "@/lib/print-slip-chunk";
import {
  loadSlipData,
  SlipAssignmentBlockedError,
  toSlipViewData,
} from "./slip-data";
import { loadPrintJob } from "./print-jobs";

/** Per-order cap so a hung Shopify/Firestore call cannot stall the whole chunk. */
const ORDER_TIMEOUT_MS = 12_000;

export async function generatePrintJobSlipChunk(
  jobId: string,
  offset: number,
  limit = PRINT_SLIP_CHUNK_SIZE,
): Promise<PrintSlipChunkResponse | null> {
  const job = await loadPrintJob(jobId);
  if (!job) return null;

  const range = printJobChunkRange(job.order_ids.length, offset, limit);
  const slice = job.order_ids.slice(range.start, range.end);
  const items: PrintSlipChunkItem[] = [];

  // Sequential on purpose: FEFO assignment contends on the same batch docs,
  // and every order must re-read live stock after the previous slip pinned
  // its units — otherwise a batch would hand out the same goods twice.
  for (const orderId of slice) {
    items.push(await generateOneSlip(orderId));
  }

  log.info("print_job_chunk", {
    jobId,
    offset: range.start,
    count: slice.length,
    total: job.order_ids.length,
    ok: items.filter((i) => i.ok).length,
    blocked: items.filter((i) => !i.ok && "blocked" in i).length,
  });

  return {
    total: job.order_ids.length,
    offset: range.start,
    nextOffset: range.nextOffset,
    done: range.done,
    items,
  };
}

async function generateOneSlip(orderId: string): Promise<PrintSlipChunkItem> {
  try {
    const data = await withTimeout(
      loadSlipData(orderId),
      ORDER_TIMEOUT_MS,
      `slip_timeout:${orderId}`,
    );
    if (!data) return { orderId, ok: false, error: "not_found" };
    return { orderId, ok: true, data: toSlipViewData(data) };
  } catch (e) {
    if (e instanceof SlipAssignmentBlockedError) {
      return {
        orderId,
        ok: false,
        blocked: {
          orderId: e.orderId,
          reason: e.reason,
          minDays: e.minDaysBeforeExpiry,
        },
      };
    }
    log.warn("print_job_slip_failed", {
      orderId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { orderId, ok: false, error: "unknown" };
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
