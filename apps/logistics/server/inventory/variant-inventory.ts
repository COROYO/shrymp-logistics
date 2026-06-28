import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { processOutbox } from "@/server/shopify/outbox";
import { queueInventoryPush } from "./sync-to-shopify";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";

export class VariantInventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariantInventoryError";
  }
}

export type ReceiveVariantInput = {
  shopId: string;
  variantId: string;
  locationId?: string;
  qty: number;
  note?: string;
  userId: string;
};

export async function receiveVariantStock(
  input: ReceiveVariantInput,
): Promise<{ newOnHandTotal: number }> {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new VariantInventoryError("invalid_qty");
  }

  const db = adminDb();
  const variantRef = db.collection(Collections.Variants).doc(input.variantId);
  const movementRef = db.collection(Collections.InventoryMovements).doc();

  const newOnHandTotal = await db.runTransaction(async (tx) => {
    const variantSnap = await tx.get(variantRef);
    if (!variantSnap.exists) {
      throw new VariantInventoryError("unknown_variant");
    }
    const variant = variantSnap.data() ?? {};
    const shopId =
      (variant["shop_id"] as string | undefined) ?? input.shopId;

    tx.set(movementRef, {
      id: movementRef.id,
      shop_id: shopId,
      type: "INBOUND",
      batch_id: null,
      variant_id: input.variantId,
      qty: input.qty,
      ref: { kind: "MANUAL", id: input.variantId },
      user_id: input.userId,
      created_at: FieldValue.serverTimestamp(),
      ...(input.note ? { note: input.note } : {}),
    });

    const onHand = (variant["on_hand_total"] as number | undefined) ?? 0;
    return onHand + input.qty;
  });

  const { getDefaultLocationId, applyDeltaToLocation, recomputeVariantTotalsFromLocations } =
    await import("@/server/locations/stock");
  const locationId =
    input.locationId ?? (await getDefaultLocationId(input.shopId));
  let resolvedOnHand = newOnHandTotal;
  if (locationId) {
    await applyDeltaToLocation(
      input.shopId,
      input.variantId,
      locationId,
      input.qty,
    );
    const totals = await recomputeVariantTotalsFromLocations(input.variantId);
    if (totals) resolvedOnHand = totals.onHand;
  }

  log.info("variant_stock_received", {
    variantId: input.variantId,
    qty: input.qty,
    locationId,
  });

  await queueInventoryPush(
    input.variantId,
    "received",
    `shrymp-logistics://variant/${input.variantId}/inbound`,
    input.shopId,
  );

  try {
    await processOutbox(20);
  } catch (e) {
    log.warn("variant_inbound_outbox_drain_failed", { error: String(e) });
  }

  await enqueueAllocationRun({
    shopId: input.shopId,
    triggeredBy: "INBOUND",
    triggerEventId: movementRef.id,
  });

  return { newOnHandTotal: resolvedOnHand };
}

export type AdjustVariantInput = {
  variantId: string;
  locationId: string;
  newOnHand: number;
  reason?: string;
  userId: string;
};

export async function adjustVariantStock(
  input: AdjustVariantInput,
): Promise<{ delta: number; shopId: string }> {
  if (!Number.isInteger(input.newOnHand) || input.newOnHand < 0) {
    throw new VariantInventoryError("invalid_qty");
  }

  const db = adminDb();
  const variantRef = db.collection(Collections.Variants).doc(input.variantId);
  const movementRef = db.collection(Collections.InventoryMovements).doc();
  const stockRef = db
    .collection(Collections.VariantLocationStock)
    .doc(
      (await import("@/server/locations/stock")).variantLocationStockDocId(
        input.variantId,
        input.locationId,
      ),
    );

  const { delta, shopId } = await db.runTransaction(async (tx) => {
    const [variantSnap, stockSnap] = await Promise.all([
      tx.get(variantRef),
      tx.get(stockRef),
    ]);
    if (!variantSnap.exists) {
      throw new VariantInventoryError("unknown_variant");
    }
    const variant = variantSnap.data() ?? {};
    const prevLocOnHand = stockSnap.exists
      ? ((stockSnap.data()?.on_hand as number | undefined) ?? 0)
      : 0;
    const delta = input.newOnHand - prevLocOnHand;

    if (delta === 0) {
      return {
        delta: 0,
        shopId: (variant["shop_id"] as string) ?? "",
      };
    }

    tx.set(
      stockRef,
      {
        id: stockRef.id,
        shop_id: variant["shop_id"] as string,
        variant_id: input.variantId,
        location_id: input.locationId,
        on_hand: input.newOnHand,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(movementRef, {
      id: movementRef.id,
      shop_id: variant["shop_id"] as string,
      type: "ADJUSTMENT",
      batch_id: null,
      variant_id: input.variantId,
      qty: delta,
      ref: { kind: "MANUAL", id: input.variantId },
      user_id: input.userId,
      ...(input.reason ? { note: input.reason } : {}),
      created_at: FieldValue.serverTimestamp(),
    });

    return {
      delta,
      shopId: (variant["shop_id"] as string) ?? "",
    };
  });

  if (delta !== 0) {
    log.info("variant_stock_adjusted", {
      variantId: input.variantId,
      locationId: input.locationId,
      delta,
    });

    const { recomputeVariantTotalsFromLocations } = await import(
      "@/server/locations/stock"
    );
    await recomputeVariantTotalsFromLocations(input.variantId);

    await queueInventoryPush(
      input.variantId,
      "correction",
      `shrymp-logistics://variant/${input.variantId}/adjustment`,
      shopId || undefined,
    );

    try {
      await processOutbox(20);
    } catch (e) {
      log.warn("variant_adjust_outbox_drain_failed", { error: String(e) });
    }

    if (shopId) {
      await enqueueAllocationRun({
        shopId,
        triggeredBy: "INBOUND",
        triggerEventId: movementRef.id,
      });
    }
  }

  return { delta, shopId };
}
