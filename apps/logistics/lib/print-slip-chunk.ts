import type {
  SlipAssignmentBlockReason,
  SlipViewData,
} from "@/app/lager/_slip/types";

/**
 * Bulk packing-slip generation is chunked so a 100–1000 order job:
 *   - never puts ids in the URL (Firestore print job + `?job=`)
 *   - never fires parallel Next.js server actions (they can deadlock)
 *   - stays under the Hosting/Cloud Run request timeout
 */

/** Orders processed per HTTP request. Sequential FEFO assign inside the chunk. */
export const PRINT_SLIP_CHUNK_SIZE = 4;

/** Server clamp — keep worst-case chunk time under the 60s hosting timeout. */
export const PRINT_SLIP_CHUNK_MAX = 8;

/**
 * Max slips mounted in the DOM for one print dialog. Larger jobs print in
 * waves so the browser does not run out of memory on huge slip trees.
 */
export const PRINT_MOUNT_LIMIT = 120;

export type PrintSlipChunkItem =
  | { orderId: string; ok: true; data: SlipViewData }
  | {
      orderId: string;
      ok: false;
      blocked: {
        orderId: string;
        reason: SlipAssignmentBlockReason;
        minDays: number;
      };
    }
  | { orderId: string; ok: false; error: "not_found" | "unknown" };

export type PrintSlipChunkResponse = {
  total: number;
  offset: number;
  nextOffset: number;
  done: boolean;
  items: PrintSlipChunkItem[];
};

export function printJobChunkRange(
  total: number,
  offset: number,
  limit: number,
): {
  start: number;
  end: number;
  nextOffset: number;
  done: boolean;
  count: number;
} {
  const safeTotal = Math.max(0, total);
  const start = Math.max(0, Math.min(Math.trunc(offset) || 0, safeTotal));
  const size = Math.min(
    PRINT_SLIP_CHUNK_MAX,
    Math.max(1, Math.trunc(limit) || 1),
  );
  const end = Math.min(safeTotal, start + size);
  return {
    start,
    end,
    nextOffset: end,
    done: end >= safeTotal,
    count: end - start,
  };
}
