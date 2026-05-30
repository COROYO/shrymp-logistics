import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type InventoryMovement,
  type User,
} from "@/server/firestore/schema";

export type BatchHistoryEntry = {
  id: string;
  type: InventoryMovement["type"];
  /** Signed: +N = Zugang, -N = Abgang. */
  qty: number;
  note: string | null;
  userName: string | null;
  refKind: string;
  refId: string;
  createdAtIso: string | null;
};

function tsToIso(t: unknown): string | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  return null;
}

/**
 * Full movement history for a single batch — every INBOUND, ADJUSTMENT,
 * RESERVE, RELEASE and CONSUME that touched it, newest first.
 *
 * `user_id` is resolved to a human-readable name where possible (system
 * movements like RESERVE from an allocation run have no user → null).
 */
export async function getBatchHistory(
  batchId: string,
  limit = 200,
): Promise<BatchHistoryEntry[]> {
  const db = adminDb();
  const snap = await db
    .collection(Collections.InventoryMovements)
    .where("batch_id", "==", batchId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();

  const movements = snap.docs.map((d) => d.data() as InventoryMovement);
  if (movements.length === 0) return [];

  // Resolve distinct user ids → names in one batched read.
  const uids = Array.from(
    new Set(
      movements
        .map((m) => m.user_id)
        .filter((u): u is string => !!u && u !== "shopify"),
    ),
  );
  const userNameByUid = new Map<string, string>();
  if (uids.length > 0) {
    const userSnaps = await db.getAll(
      ...uids.map((id) => db.collection(Collections.Users).doc(id)),
    );
    for (const u of userSnaps) {
      if (!u.exists) continue;
      const data = u.data() as User;
      userNameByUid.set(u.id, data.display_name || data.email || u.id);
    }
  }

  return movements.map<BatchHistoryEntry>((m) => ({
    id: m.id,
    type: m.type,
    qty: m.qty,
    note: m.note ?? null,
    userName:
      m.user_id === "shopify"
        ? "Shopify"
        : m.user_id
          ? (userNameByUid.get(m.user_id) ?? m.user_id)
          : null,
    refKind: m.ref?.kind ?? "MANUAL",
    refId: m.ref?.id ?? "",
    createdAtIso: tsToIso(m.created_at),
  }));
}
