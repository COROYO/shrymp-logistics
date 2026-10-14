"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import {
  SHOPIFY_FULFILLMENT_STATUSES,
  SHOPIFY_PAYMENT_STATUSES,
} from "@/lib/orders/shopify-status";
import { log } from "@/lib/logger";
import { updateShopShipStatuses } from "@/server/tenant/shop";

const InputSchema = z.object({
  ship_payment_statuses: z.array(z.enum(SHOPIFY_PAYMENT_STATUSES)),
  ship_fulfillment_statuses: z.array(z.enum(SHOPIFY_FULFILLMENT_STATUSES)),
});

export type SaveShipStatusesResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function saveShipStatusesAction(
  formData: FormData,
): Promise<SaveShipStatusesResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = InputSchema.safeParse({
    ship_payment_statuses: formData.getAll("ship_payment_statuses"),
    ship_fulfillment_statuses: formData.getAll("ship_fulfillment_statuses"),
  });
  if (!parsed.success) {
    return { ok: false, error: "validation", details: parsed.error.flatten() };
  }

  const shopId = await requireActiveShopId(user);
  await updateShopShipStatuses(shopId, {
    ship_payment_statuses: parsed.data.ship_payment_statuses,
    ship_fulfillment_statuses: parsed.data.ship_fulfillment_statuses,
    updated_by_uid: user.uid,
  });

  log.info("ship_statuses_saved", {
    uid: user.uid,
    shopId,
    ship_payment_statuses: parsed.data.ship_payment_statuses,
    ship_fulfillment_statuses: parsed.data.ship_fulfillment_statuses,
  });

  await enqueueAllocationRun({
    shopId,
    triggeredBy: "MANUAL",
    triggerEventId: `ship-statuses:${user.uid}`,
  });

  revalidatePath("/admin/settings/auftraege");
  revalidatePath("/lager/picking");
  revalidatePath("/admin/orders");
  return { ok: true };
}
