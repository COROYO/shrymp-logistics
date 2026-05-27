import "server-only";
import { getDhlAccessToken, invalidateDhlAccessToken } from "./auth";
import { dhlBaseUrl } from "./config";
import type { DhlConfig } from "@/server/firestore/schema";
import type {
  DhlLabelDataResponse,
  DhlShipmentOrderRequest,
} from "./types";
import { log } from "@/lib/logger";

/**
 * Thin wrapper around the DHL Parcel DE Shipping v2 REST API.
 *
 * Auth strategy: OAuth2 Bearer ONLY. DHL explicitly rejects requests that
 * combine `Authorization: Bearer` with `dhl-api-key` ("Invalid combination
 * of credentials"). The client_id/client_secret are used solely to mint
 * the token in `auth.ts`.
 */

export class DhlApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "DhlApiError";
  }
}

async function authedHeaders(cfg: DhlConfig): Promise<HeadersInit> {
  const token = await getDhlAccessToken(cfg);
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export type CreateOrdersOptions = {
  /** If true, request a dry-run validation against the DHL backend. */
  validate?: boolean;
  /** Label format. `URL` lets us fetch the PDF in a separate request. */
  includeDocs?: "include" | "URL";
  docFormat?: "PDF" | "ZPL2";
  printFormat?: string;
};

export async function createOrders(
  cfg: DhlConfig,
  body: DhlShipmentOrderRequest,
  opts: CreateOrdersOptions = {},
): Promise<DhlLabelDataResponse> {
  const params = new URLSearchParams();
  if (opts.validate) params.set("validate", "true");
  params.set("includeDocs", opts.includeDocs ?? "include");
  params.set("docFormat", opts.docFormat ?? "PDF");
  if (opts.printFormat) params.set("printFormat", opts.printFormat);

  const url = `${dhlBaseUrl(cfg)}/orders?${params.toString()}`;
  const payload = JSON.stringify(body);

  // Try once; on 401 (expired/revoked token) wipe the cache and retry once.
  let attempt = 0;
  while (attempt < 2) {
    const res = await fetch(url, {
      method: "POST",
      headers: await authedHeaders(cfg),
      body: payload,
      cache: "no-store",
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (res.status === 401 && attempt === 0) {
      log.warn("dhl_create_orders_401_retry", {
        body: text.slice(0, 300),
      });
      invalidateDhlAccessToken(cfg);
      attempt++;
      continue;
    }

    // HTTP 200 = single shipment OK; 207 = multistatus with per-item status.
    if (res.status !== 200 && res.status !== 207) {
      log.warn("dhl_create_orders_http_failed", {
        status: res.status,
        body: text.slice(0, 1000),
      });
      throw new DhlApiError(
        res.status,
        parsed,
        `DHL createOrders HTTP ${res.status}`,
      );
    }
    return parsed as DhlLabelDataResponse;
  }
  throw new DhlApiError(401, null, "DHL createOrders HTTP 401 after retry");
}

export async function downloadLabelPdf(labelUrl: string): Promise<Buffer> {
  const res = await fetch(labelUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new DhlApiError(
      res.status,
      null,
      `DHL label download HTTP ${res.status}`,
    );
  }
  const arr = new Uint8Array(await res.arrayBuffer());
  return Buffer.from(arr);
}
