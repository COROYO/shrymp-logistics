import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";

/**
 * Lieferschein-Nr / delivery-note number assignment.
 *
 * The number is a legal commercial reference — the same order must always
 * print with the same number across reprints. We persist it on the order
 * doc the first time the slip is generated and reuse it thereafter.
 *
 * Format: `L{seq:05}/{YY}` — e.g. `L00042/26`. The sequence is a single
 * monotonic counter across the whole shop, stored in
 * `config/counters.lieferschein_seq`, incremented atomically. Year roll-over
 * does NOT reset the counter (matches German bookkeeping convention: the
 * sequence is unique, the year is informational).
 */

const COUNTER_DOC = "counters";
const COUNTER_FIELD = "lieferschein_seq";

export type LieferscheinRef = {
  number: string; // e.g. "L00042/26"
  dateIso: string; // when it was issued (ISO)
};

/**
 * Fetch the existing Lieferschein-Nr for an order, or assign a fresh one
 * if none exists. Safe to call concurrently — the counter increment is
 * atomic via `FieldValue.increment(1)` + a transactional read on the
 * order doc.
 */
export async function getOrAssignLieferscheinNo(
  orderId: string,
): Promise<LieferscheinRef> {
  const db = adminDb();
  const orderRef = db.collection(Collections.Orders).doc(orderId);
  const counterRef = db.collection(Collections.Config).doc(COUNTER_DOC);

  const result = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error(`order_not_found:${orderId}`);
    }
    const data = orderSnap.data() as Order | undefined;
    if (data?.lieferschein_no) {
      // Already assigned — return existing.
      const dateTs = data.lieferschein_date as unknown as
        | { toDate?(): Date }
        | undefined;
      const iso =
        dateTs && typeof dateTs.toDate === "function"
          ? dateTs.toDate().toISOString()
          : new Date().toISOString();
      return { number: data.lieferschein_no, dateIso: iso };
    }

    // No number yet — increment counter, format, persist on order.
    const counterSnap = await tx.get(counterRef);
    const current =
      (counterSnap.data()?.[COUNTER_FIELD] as number | undefined) ?? 0;
    const next = current + 1;

    tx.set(
      counterRef,
      { [COUNTER_FIELD]: next, updated_at: FieldValue.serverTimestamp() },
      { merge: true },
    );

    const number = formatLieferscheinNo(next, new Date());
    const now = new Date();
    tx.update(orderRef, {
      lieferschein_no: number,
      lieferschein_date: Timestamp.fromDate(now),
    });
    return { number, dateIso: now.toISOString() };
  });

  return result;
}

export function formatLieferscheinNo(seq: number, date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const padded = String(seq).padStart(5, "0");
  return `L${padded}/${yy}`;
}
