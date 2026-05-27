import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Order,
  type OrderDhlShipment,
} from "@/server/firestore/schema";
import { assertDhlReady, loadDhlConfig } from "./config";
import { createOrders, downloadLabelPdf, DhlApiError } from "./client";
import { buildShipmentOrderRequest } from "./request-builder";
import { DhlServicesError } from "./services";
import { uploadLabelPdf } from "./storage";
import { log } from "@/lib/logger";

/**
 * Create a shipping label for an order via the DHL Parcel DE Shipping API.
 *
 * Steps:
 *   1. Load config + order
 *   2. Map order to a single-shipment ShipmentOrderRequest
 *   3. POST /orders?includeDocs=URL → DHL returns shipmentNo + label URL
 *   4. Download the PDF from that URL
 *   5. Upload PDF to Firebase Storage, get a 7d signed URL
 *   6. Persist `dhl_shipment` on the order doc
 *
 * The function is intentionally NOT a Firestore transaction: it issues an
 * external HTTP call. Idempotency is on the caller — re-creating a label
 * overwrites the previous DHL shipment metadata.
 */

export class CreateLabelError extends Error {
  constructor(
    public readonly code:
      | "order_not_found"
      | "no_shipping_address"
      | "dhl_validation_failed"
      | "dhl_no_label_returned"
      | "dhl_http_error"
      | "dhl_services_error",
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = "CreateLabelError";
  }
}

export type CreateLabelInput = {
  orderId: string;
  userId: string;
  weightG?: number;
  /**
   * Manual COD amount in cents, used when the order has tag NACHNAHME but no
   * `cod_amount_cents` value (e.g. legacy / unpaid orders). Ignored for
   * non-COD orders.
   */
  codAmountCents?: number | null;
};

export type CreateLabelResult = {
  shipmentNo: string;
  trackingUrl: string;
  labelUrl: string;
  labelStoragePath: string;
};

export async function createLabelForOrder(
  input: CreateLabelInput,
): Promise<CreateLabelResult> {
  const { orderId, userId, weightG, codAmountCents } = input;
  const db = adminDb();

  const cfg = await loadDhlConfig();
  assertDhlReady(cfg);

  const orderSnap = await db.collection(Collections.Orders).doc(orderId).get();
  if (!orderSnap.exists) {
    throw new CreateLabelError("order_not_found");
  }
  const order = orderSnap.data() as Order;
  if (!order.shipping_address) {
    throw new CreateLabelError("no_shipping_address");
  }

  let requestBody;
  try {
    requestBody = buildShipmentOrderRequest({
      order,
      config: cfg,
      weightG,
      codAmountCents,
    });
  } catch (e) {
    if (e instanceof DhlServicesError) {
      throw new CreateLabelError("dhl_services_error", e.message, e.code);
    }
    throw e;
  }

  let response;
  try {
    response = await createOrders(cfg, requestBody, {
      includeDocs: "URL",
      docFormat: "PDF",
    });
  } catch (e) {
    if (e instanceof DhlApiError) {
      throw new CreateLabelError(
        "dhl_http_error",
        `DHL HTTP ${e.status}`,
        e.body,
      );
    }
    throw e;
  }

  const item = response.items?.[0];
  if (!item || (item.sstatus.status ?? 0) >= 400) {
    log.warn("dhl_create_orders_item_error", { item, status: response.status });
    throw new CreateLabelError(
      "dhl_validation_failed",
      item?.sstatus.detail ?? "DHL rejected shipment",
      item?.validationMessages,
    );
  }
  const shipmentNo = item.shipmentNo;
  const labelUrl = item.label?.url;
  if (!shipmentNo || !labelUrl) {
    throw new CreateLabelError(
      "dhl_no_label_returned",
      "DHL response missing shipmentNo/label.url",
      item,
    );
  }

  const pdf = await downloadLabelPdf(labelUrl);
  const stored = await uploadLabelPdf(orderId, shipmentNo, pdf);

  const trackingUrl = `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(shipmentNo)}`;

  const product = requestBody.shipments[0]?.product ?? "V01PAK";
  const weight = requestBody.shipments[0]?.details.weight.value ?? cfg.default_weight_g;

  const dhlShipment: OrderDhlShipment = {
    shipment_no: shipmentNo,
    product,
    tracking_url: trackingUrl,
    label_storage_path: stored.storagePath,
    label_url: stored.signedUrl,
    label_url_expires_at: stored.expiresAt,
    weight_g: weight,
    created_at: new Date(),
    created_by_uid: userId,
    sandbox: cfg.sandbox,
  };

  await db.collection(Collections.Orders).doc(orderId).update({
    dhl_shipment: {
      ...dhlShipment,
      created_at: FieldValue.serverTimestamp(),
    },
    updated_at: FieldValue.serverTimestamp(),
  });

  log.info("dhl_label_created", {
    orderId,
    userId,
    shipmentNo,
    product,
    sandbox: cfg.sandbox,
  });

  return {
    shipmentNo,
    trackingUrl,
    labelUrl: stored.signedUrl,
    labelStoragePath: stored.storagePath,
  };
}
