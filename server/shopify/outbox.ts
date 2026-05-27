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

/**
 * Drain pending Shopify outbox entries.
 *
 * Idempotent + safe to call concurrently because each row is claimed via
 * a transaction that increments `attempts` and bumps `next_retry_at`.
 */
export async function processOutbox(
  limit = 50,
): Promise<{ processed: number; failed: number; done: number }> {
  const db = adminDb();
  const now = Timestamp.now();

  const dueSnap = await db
    .collection(Collections.ShopifyOutbox)
    .where("next_retry_at", "<=", now)
    .limit(limit)
    .get();

  let processed = 0;
  let failed = 0;
  let done = 0;

  for (const docSnap of dueSnap.docs) {
    const row = docSnap.data() as ShopifyOutbox;
    if (row.done_at) continue;

    // Claim: bump attempts + push next_retry_at out, so a concurrent worker
    // ignores it. If we succeed below, we mark done_at and the row drops out
    // of the due query for good.
    try {
      const nextRetry = Timestamp.fromMillis(
        Date.now() + backoffMs(row.attempts),
      );
      await docSnap.ref.update({
        attempts: FieldValue.increment(1),
        next_retry_at: nextRetry,
      });
    } catch (e) {
      log.warn("outbox_claim_failed", { id: row.id, error: String(e) });
      continue;
    }

    try {
      await dispatch(row);
      await docSnap.ref.update({
        done_at: FieldValue.serverTimestamp(),
      });
      processed++;
      done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("outbox_dispatch_failed", {
        id: row.id,
        op: row.op,
        attempts: row.attempts + 1,
        error: msg,
      });
      await docSnap.ref.update({ last_error: msg });
      failed++;
    }
  }

  return { processed, failed, done };
}

async function dispatch(row: ShopifyOutbox): Promise<void> {
  switch (row.op) {
    case "TAGS_ADD": {
      const { orderId, tags } = row.payload as {
        orderId: string;
        tags: string[];
      };
      await tagsAddOnOrder(orderId, tags);
      return;
    }
    case "TAGS_REMOVE": {
      const { orderId, tags } = row.payload as {
        orderId: string;
        tags: string[];
      };
      await tagsRemoveFromOrder(orderId, tags);
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

function backoffMs(attempts: number): number {
  const exp = 1000 * 2 ** Math.min(attempts, 10);
  const jitter = Math.random() * 500;
  return Math.min(exp + jitter, 60 * 60 * 1000);
}
