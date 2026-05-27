"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  confirmPacking,
  startPicking,
  TransitionError,
  type TrackingInput,
} from "@/server/picking/transitions";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";
import {
  createLabelForOrder,
  CreateLabelError,
} from "@/server/dhl/labels";
import { DhlConfigError } from "@/server/dhl/config";
import { DhlAuthError } from "@/server/dhl/auth";
import { DhlApiError } from "@/server/dhl/client";
import { AddressMappingError } from "@/server/dhl/request-builder";
import { DhlServicesError } from "@/server/dhl/services";
import { log } from "@/lib/logger";

const TrackingSchema = z
  .object({
    carrier: z.string().max(80).optional(),
    number: z.string().max(80).optional(),
    url: z.string().url().optional(),
  })
  .optional();

export type ConfirmPackingActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function confirmPackingAction(
  orderId: string,
  tracking: TrackingInput | null,
): Promise<ConfirmPackingActionResult> {
  let user;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsedTracking = TrackingSchema.safeParse(tracking ?? undefined);
  if (!parsedTracking.success) {
    return { ok: false, error: "invalid_tracking" };
  }

  try {
    await confirmPacking(orderId, user.uid, parsedTracking.data);
    revalidatePath("/lager/picking");
    revalidatePath("/admin/orders");
    return { ok: true };
  } catch (e) {
    log.warn("confirm_packing_failed", { orderId, error: String(e) });
    if (e instanceof TransitionError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

const WeightSchema = z
  .number()
  .int()
  .min(1)
  .max(31500)
  .optional();

const CodAmountCentsSchema = z
  .number()
  .int()
  .min(1)
  .max(350000) // DHL hard cap: 3500 EUR per shipment
  .nullable()
  .optional();

export type CreateDhlLabelActionResult =
  | {
      ok: true;
      shipmentNo: string;
      labelUrl: string;
      trackingUrl: string;
    }
  | { ok: false; error: string; details?: unknown };

/**
 * Server action: trigger DHL label creation for an order from the Packing UI.
 *
 * Returns the signed URL of the PDF so the client can open it in a new tab
 * (the warehouse staff prints the label from there). Tracking number is
 * stored on the order and later picked up by the confirm-packing flow.
 */
export async function createDhlLabelAction(
  orderId: string,
  weightG?: number,
  codAmountCents?: number | null,
): Promise<CreateDhlLabelActionResult> {
  let user;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = WeightSchema.safeParse(weightG);
  if (!parsed.success) return { ok: false, error: "invalid_weight" };

  const parsedCod = CodAmountCentsSchema.safeParse(codAmountCents);
  if (!parsedCod.success) return { ok: false, error: "invalid_cod_amount" };

  try {
    const res = await createLabelForOrder({
      orderId,
      userId: user.uid,
      weightG: parsed.data,
      codAmountCents: parsedCod.data ?? null,
    });

    // ---- Auto-pack on label creation ----
    // Once the label is printed, the order is leaving the warehouse — treat
    // it as packed: mark Shopify fulfilled, decrement stock, etc. Best-effort
    // so a failure here doesn't roll back the label that was already created.
    try {
      const orderSnap = await adminDb()
        .collection(Collections.Orders)
        .doc(orderId)
        .get();
      const order = orderSnap.data() as Order | undefined;
      if (order && order.internal_status !== "PACKED") {
        if (order.internal_status === "SHIP" || order.internal_status === "NEW") {
          await startPicking(orderId, user.uid);
        }
        await confirmPacking(orderId, user.uid, {
          carrier: "DHL",
          number: res.shipmentNo,
          url: res.trackingUrl,
        });
      }
    } catch (autoPackErr) {
      log.warn("auto_pack_after_label_failed", {
        orderId,
        error: String(autoPackErr),
      });
    }

    revalidatePath(`/lager/packing/${orderId}`);
    revalidatePath("/lager/picking");
    revalidatePath("/admin/orders");
    return {
      ok: true,
      shipmentNo: res.shipmentNo,
      labelUrl: res.labelUrl,
      trackingUrl: res.trackingUrl,
    };
  } catch (e) {
    log.warn("create_dhl_label_failed", { orderId, error: String(e) });
    if (e instanceof DhlConfigError) {
      return { ok: false, error: `dhl_config:${e.code}` };
    }
    if (e instanceof AddressMappingError) {
      return { ok: false, error: `address:${e.code}` };
    }
    if (e instanceof DhlServicesError) {
      return { ok: false, error: `dhl_services:${e.code}` };
    }
    if (e instanceof CreateLabelError && e.code === "dhl_services_error") {
      return { ok: false, error: `dhl_services:${e.message}`, details: e.details };
    }
    if (e instanceof DhlAuthError) {
      return { ok: false, error: `dhl_auth:${e.status}` };
    }
    if (e instanceof DhlApiError) {
      return { ok: false, error: `dhl_api:${e.status}`, details: e.body };
    }
    if (e instanceof CreateLabelError) {
      return { ok: false, error: e.code, details: e.details };
    }
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
