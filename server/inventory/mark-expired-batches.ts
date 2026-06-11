import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Batch } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { isBatchExpired } from "@/server/picking/batch-assignability";

export type MarkExpiredBatchesResult = {
  marked: number;
  batchIds: string[];
};

/**
 * Set `status: EXPIRED` on ACTIVE Chargen whose MHD has passed (Berlin calendar)
 * but still have physical stock (`remaining_qty > 0`).
 */
export async function markExpiredBatches(): Promise<MarkExpiredBatchesResult> {
  const db = adminDb();
  const referenceDate = new Date();

  const snap = await db
    .collection(Collections.Batches)
    .where("status", "==", "ACTIVE")
    .get();

  const toMark: string[] = [];
  for (const doc of snap.docs) {
    const b = doc.data() as Batch;
    if ((b.remaining_qty ?? 0) <= 0) continue;
    if (isBatchExpired(b.expiry_date, referenceDate)) {
      toMark.push(doc.id);
    }
  }

  if (toMark.length === 0) {
    return { marked: 0, batchIds: [] };
  }

  const bulk = db.bulkWriter();
  for (const id of toMark) {
    void bulk.update(db.collection(Collections.Batches).doc(id), {
      status: "EXPIRED",
    });
  }
  await bulk.close();

  log.info("batches_marked_expired", { count: toMark.length, ids: toMark });
  return { marked: toMark.length, batchIds: toMark };
}
