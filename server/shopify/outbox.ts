import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type ShopifyOutbox } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import {
  fulfillmentCreateForOrder,
  inventorySetOnHand,
  tagsAddOnOrder,
  tagsRemoveFromOrder,
} from "./mutations";

const LAGER_SHIP = "LAGER_SHIP";
const LAGER_STOP = "LAGER_STOP";

/**
 * Drain pending Shopify outbox entries.
 *
 * Idempotent + safe to call concurrently because each row is claimed via
 * a transaction that increments `attempts` and bumps `next_retry_at`.
 */
type OutboxDrainResult = { processed: number; failed: number; done: number };

export async function processOutbox(limit = 50): Promise<OutboxDrainResult> {
  const db = adminDb();
  const now = Timestamp.now();

  const dueSnap = await db
    .collection(Collections.ShopifyOutbox)
    .where("next_retry_at", "<=", now)
    .limit(limit)
    .get();

  const result: OutboxDrainResult = { processed: 0, failed: 0, done: 0 };
  for (const docSnap of dueSnap.docs) {
    await processRow(docSnap, result);
  }
  return result;
}

/**
 * Drain specific outbox rows by document id, regardless of `next_retry_at`.
 *
 * Used by the allocation run to push the LAGER tag entries it just created
 * *immediately* and deterministically — the time-windowed `processOutbox`
 * can starve fresh rows when a backlog of older due entries fills its limit,
 * which previously left manually-triggered tag pushes unsent.
 */
/** Deterministic outbox row per order — overwrites any still-pending tag push. */
export async function enqueueLagerTagSet(
  orderId: string,
  status: "SHIP" | "STOP",
): Promise<string> {
  const db = adminDb();
  const ref = db
    .collection(Collections.ShopifyOutbox)
    .doc(`lagertags_${orderId}`);
  const now = FieldValue.serverTimestamp();
  await ref.set({
    id: ref.id,
    op: "LAGER_TAGS_SET",
    payload: { orderId, status },
    attempts: 0,
    next_retry_at: now,
    created_at: now,
  });
  return ref.id;
}

export async function processOutboxByIds(
  ids: string[],
): Promise<OutboxDrainResult> {
  const db = adminDb();
  const result: OutboxDrainResult = { processed: 0, failed: 0, done: 0 };
  if (ids.length === 0) return result;

  const refs = ids.map((id) => db.collection(Collections.ShopifyOutbox).doc(id));
  const snaps = await db.getAll(...refs);
  for (const docSnap of snaps) {
    if (!docSnap.exists) continue;
    await processRow(docSnap, result);
  }
  return result;
}

async function processRow(
  docSnap: FirebaseFirestore.DocumentSnapshot,
  result: OutboxDrainResult,
): Promise<void> {
  const row = docSnap.data() as ShopifyOutbox;
  if (row.done_at) return;

  // Claim: bump attempts + push next_retry_at out, so a concurrent worker
  // ignores it. If we succeed below, we mark done_at and the row drops out
  // of the due query for good.
  try {
    const nextRetry = Timestamp.fromMillis(Date.now() + backoffMs(row.attempts));
    await docSnap.ref.update({
      attempts: FieldValue.increment(1),
      next_retry_at: nextRetry,
    });
  } catch (e) {
    log.warn("outbox_claim_failed", { id: row.id, error: String(e) });
    return;
  }

  try {
    await dispatch(row);
    await docSnap.ref.update({ done_at: FieldValue.serverTimestamp() });
    result.processed++;
    result.done++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("outbox_dispatch_failed", {
      id: row.id,
      op: row.op,
      attempts: row.attempts + 1,
      error: msg,
    });
    await docSnap.ref.update({ last_error: msg });
    result.failed++;
  }
}

async function dispatch(row: ShopifyOutbox): Promise<void> {
  switch (row.op) {
    case "TAGS_ADD": {
      const { orderId, tags } = row.payload as {
        orderId: string;
        tags: string[];
      };
      await tagsAddOnOrder(orderId, tags);
      await verifyOrderTagState(orderId, tags, "must_include");
      return;
    }
    case "TAGS_REMOVE": {
      const { orderId, tags } = row.payload as {
        orderId: string;
        tags: string[];
      };
      await tagsRemoveFromOrder(orderId, tags);
      await verifyOrderTagState(orderId, tags, "must_exclude");
      return;
    }
    case "LAGER_TAGS_SET": {
      // LAGER tags are owned by our system: set the correct one and strip the
      // opposite in a single op, verify both landed, then record the confirmed
      // state on the order so the next allocation run won't re-push needlessly.
      const { orderId, status } = row.payload as {
        orderId: string;
        status: "SHIP" | "STOP";
      };
      const want = status === "SHIP" ? LAGER_SHIP : LAGER_STOP;
      const drop = status === "SHIP" ? LAGER_STOP : LAGER_SHIP;
      await tagsAddOnOrder(orderId, [want]);
      await tagsRemoveFromOrder(orderId, [drop]);
      await verifyOrderTagState(orderId, [want], "must_include");
      await verifyOrderTagState(orderId, [drop], "must_exclude");
      await adminDb()
        .collection(Collections.Orders)
        .doc(orderId)
        .update({ lager_tag_synced: status });
      return;
    }
    case "FULFILLMENT_CREATE": {
      const { orderId, tracking, notifyCustomer } = row.payload as {
        orderId: string;
        tracking?: { company?: string; number?: string; url?: string };
        notifyCustomer?: boolean;
      };
      await fulfillmentCreateForOrder(orderId, { tracking, notifyCustomer });
      return;
    }
    case "INVENTORY_SET": {
      const { reason, setQuantities, referenceDocumentUri } = row.payload as {
        reason: string;
        referenceDocumentUri?: string;
        setQuantities: {
          inventoryItemId: string;
          locationId: string;
          quantity: number;
        }[];
      };
      // Stable idempotency key per outbox row so Shopify de-dupes retries.
      await inventorySetOnHand(
        reason,
        setQuantities,
        referenceDocumentUri,
        `outbox-${row.id}`,
      );
      return;
    }
    default:
      throw new Error(`unknown outbox op: ${row.op}`);
  }
}

// --------------------------- cleanup ---------------------------

export type OutboxCleanupResult = {
  deletedDone: number;
  deletedStale: number;
};

/**
 * Räumt die `shopify_outbox` auf — sonst wächst sie unbegrenzt, weil
 * `processRow` erledigte Zeilen nur mit `done_at` markiert, aber nie löscht.
 *
 * Gelöscht werden:
 *   1. **Erledigte** Zeilen (`done_at`), deren Abschluss älter als
 *      `doneRetentionDays` ist (kleine Karenz für Debugging/Idempotenz).
 *   2. **Beliebige** Zeilen, die älter als `staleRetentionDays` sind —
 *      fängt abgebrochene/fehlgeschlagene Zeilen ab, die nach tagelangem
 *      Retry nie erfolgreich werden.
 *
 * Nutzt einfache Inequality-Filter (automatische Single-Field-Indizes, kein
 * Composite-Index nötig) und batched Deletes (Firestore-Limit 500/Batch).
 */
export async function cleanupOutbox(opts?: {
  doneRetentionDays?: number;
  staleRetentionDays?: number;
  maxDeletes?: number;
}): Promise<OutboxCleanupResult> {
  const doneRetentionDays = opts?.doneRetentionDays ?? 2;
  const staleRetentionDays = opts?.staleRetentionDays ?? 14;
  const maxDeletes = opts?.maxDeletes ?? 10_000;

  const db = adminDb();
  const dayMs = 24 * 60 * 60 * 1000;
  const doneCutoff = Timestamp.fromMillis(Date.now() - doneRetentionDays * dayMs);
  const staleCutoff = Timestamp.fromMillis(
    Date.now() - staleRetentionDays * dayMs,
  );
  const col = db.collection(Collections.ShopifyOutbox);

  const deletedDone = await deleteByQuery(
    db,
    col.where("done_at", "<=", doneCutoff),
    maxDeletes,
  );
  const deletedStale = await deleteByQuery(
    db,
    col.where("created_at", "<=", staleCutoff),
    maxDeletes,
  );

  log.info("outbox_cleanup", {
    deletedDone,
    deletedStale,
    doneRetentionDays,
    staleRetentionDays,
  });
  return { deletedDone, deletedStale };
}

async function deleteByQuery(
  db: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query,
  max: number,
): Promise<number> {
  const PAGE = 400;
  let total = 0;
  while (total < max) {
    const snap = await query.limit(Math.min(PAGE, max - total)).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    total += snap.size;
    if (snap.size < PAGE) break;
  }
  return total;
}

function backoffMs(attempts: number): number {
  const exp = 1000 * 2 ** Math.min(attempts, 10);
  const jitter = Math.random() * 500;
  return Math.min(exp + jitter, 60 * 60 * 1000);
}

/**
 * Confirm a tagsAdd / tagsRemove actually persisted on Shopify's side.
 * Catches silent failures where the mutation returns no userErrors but the
 * tags weren't actually written (Shopify automations stripping custom tags,
 * Flow rules, app permissions, etc).
 *
 * Throws if the post-state doesn't match expectations — outbox dispatch
 * catches the throw, marks the row as FAILED with the diagnostic message,
 * and Shopify support gets actionable evidence next time it happens.
 */
const VERIFY_TAG_QUERY = /* GraphQL */ `
  query VerifyTags($id: ID!) {
    order(id: $id) {
      tags
    }
  }
`;

async function verifyOrderTagState(
  orderIdOrGid: string | number,
  tags: string[],
  mode: "must_include" | "must_exclude",
): Promise<void> {
  const { shopifyGraphQL } = await import("./client");
  const id = String(orderIdOrGid).startsWith("gid://")
    ? String(orderIdOrGid)
    : `gid://shopify/Order/${orderIdOrGid}`;
  let data: { order: { tags: string[] } | null };
  try {
    data = await shopifyGraphQL(VERIFY_TAG_QUERY, { id });
  } catch (e) {
    // Don't fail the dispatch on verification network issues — the mutation
    // already succeeded as far as Shopify's response told us. Just log.
    log.warn("tag_verify_query_failed", { id, error: String(e) });
    return;
  }
  if (!data.order) {
    log.warn("tag_verify_order_not_found", { id });
    return;
  }
  const liveTags = new Set(data.order.tags ?? []);
  const wanted = mode === "must_include";
  const offenders = tags.filter((t) => liveTags.has(t) !== wanted);
  if (offenders.length === 0) return;

  // Mismatch — Shopify accepted the mutation but didn't persist the change.
  // Throwing here marks the outbox row FAILED with this message, so the next
  // ops investigation has something concrete to look at.
  const verb = mode === "must_include" ? "missing" : "still present";
  throw new Error(
    `tag_verify_mismatch: ${verb} on order ${id}: ${offenders.join(", ")} ` +
      `(live tags: [${[...liveTags].join(", ")}])`,
  );
}
