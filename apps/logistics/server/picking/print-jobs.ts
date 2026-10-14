import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { parseOrderIds } from "@/lib/print-slips-ids";

export const PRINT_JOB_TTL_MS = 1000 * 60 * 60 * 24;

export type PrintJob = {
  id: string;
  order_ids: string[];
  created_at: Date;
  created_by_uid: string;
};

export async function createPrintJob(
  orderIds: string[],
  uid: string,
): Promise<PrintJob> {
  const ids = parseOrderIds(orderIds);
  if (ids.length === 0) {
    throw new Error("print_job_empty");
  }

  const db = adminDb();
  const ref = db.collection(Collections.PrintJobs).doc();
  const now = new Date();
  await ref.set({
    id: ref.id,
    order_ids: ids,
    created_at: Timestamp.fromDate(now),
    created_by_uid: uid,
  });
  return {
    id: ref.id,
    order_ids: ids,
    created_at: now,
    created_by_uid: uid,
  };
}

export async function loadPrintJob(jobId: string): Promise<PrintJob | null> {
  const id = jobId.trim();
  if (!id) return null;

  const snap = await adminDb().collection(Collections.PrintJobs).doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as {
    order_ids?: unknown;
    created_at?: { toDate?: () => Date; seconds?: number };
    created_by_uid?: unknown;
  };

  const createdAt = timestampToDate(data.created_at);
  if (createdAt && Date.now() - createdAt.getTime() > PRINT_JOB_TTL_MS) {
    return null;
  }

  const order_ids = parseOrderIds(
    Array.isArray(data.order_ids) ? data.order_ids.map((v) => String(v)) : [],
  );
  if (order_ids.length === 0) return null;

  return {
    id: snap.id,
    order_ids,
    created_at: createdAt ?? new Date(),
    created_by_uid:
      typeof data.created_by_uid === "string" ? data.created_by_uid : "",
  };
}

function timestampToDate(
  t: { toDate?: () => Date; seconds?: number } | undefined,
): Date | null {
  if (!t) return null;
  if (typeof t.toDate === "function") return t.toDate();
  if (typeof t.seconds === "number") return new Date(t.seconds * 1000);
  return null;
}
