import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type InventoryMovement,
  type Order,
  type User,
} from "@/server/firestore/schema";
import type { BatchHistoryEntry } from "./batch-history";

function tsToIso(t: unknown): string | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function") return o.toDate().toISOString();
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString();
  return null;
}

const MOVEMENT_TYPES = [
  "INBOUND",
  "ADJUSTMENT",
  "EXTERNAL_DRIFT",
  "CONSUME",
] as const;

/**
 * Physical history for a variant (no batch tracking), newest first.
 * Used when Chargen management is disabled — stock lives on the variant doc.
 */
export async function getVariantHistory(
  variantId: string,
  limit = 200,
): Promise<BatchHistoryEntry[]> {
  const db = adminDb();

  const movSnap = await db
    .collection(Collections.InventoryMovements)
    .where("variant_id", "==", variantId)
    .where("type", "in", [...MOVEMENT_TYPES])
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();

  const movements = movSnap.docs.map((d) => d.data() as InventoryMovement);
  if (movements.length === 0) return [];

  const orderIds = new Set<string>();
  for (const m of movements) {
    if (m.ref?.kind === "ORDER" && m.ref.id) orderIds.add(m.ref.id);
  }

  const orderById = new Map<string, Order>();
  if (orderIds.size > 0) {
    const orderSnaps = await db.getAll(
      ...[...orderIds].map((id) => db.collection(Collections.Orders).doc(id)),
    );
    for (const o of orderSnaps) {
      if (o.exists) orderById.set(o.id, o.data() as Order);
    }
  }

  const uids = new Set<string>();
  for (const m of movements) {
    if (m.user_id && m.user_id !== "shopify") uids.add(m.user_id);
  }
  for (const o of orderById.values()) {
    if (o.packed_by_uid && o.packed_by_uid !== "shopify")
      uids.add(o.packed_by_uid);
  }

  const userNameByUid = new Map<string, string>();
  if (uids.size > 0) {
    const userSnaps = await db.getAll(
      ...[...uids].map((id) => db.collection(Collections.Users).doc(id)),
    );
    for (const u of userSnaps) {
      if (!u.exists) continue;
      const data = u.data() as User;
      userNameByUid.set(u.id, data.display_name || data.email || u.id);
    }
  }

  const resolveActor = (uid: string | null | undefined): string | null =>
    uid === "shopify"
      ? "Shopify"
      : uid
        ? (userNameByUid.get(uid) ?? uid)
        : null;

  const entries: BatchHistoryEntry[] = movements.map((m) => {
    const order =
      m.ref?.kind === "ORDER" ? orderById.get(m.ref.id) : undefined;
    const type =
      m.type === "CONSUME" ? ("SALE" as const) : m.type;
    return {
      id: m.id,
      type,
      qty: m.qty,
      note:
        m.note ??
        (order?.name ? order.name : m.type === "CONSUME" ? m.ref?.id : null),
      userName: resolveActor(
        m.type === "CONSUME" ? order?.packed_by_uid : m.user_id,
      ),
      refKind: m.ref?.kind ?? "MANUAL",
      refId: m.ref?.id ?? "",
      createdAtIso: tsToIso(m.created_at),
    };
  });

  entries.sort((a, b) => {
    const am = a.createdAtIso ? Date.parse(a.createdAtIso) : 0;
    const bm = b.createdAtIso ? Date.parse(b.createdAtIso) : 0;
    return bm - am;
  });

  return entries.slice(0, limit);
}
